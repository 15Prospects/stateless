import request from 'supertest';
import { assert } from 'chai';
import setupServer from './testServer';
import { createUser, fetchUser, updateUser, authRules } from './helpers';
import { getXSRF } from '../src/clientHelpers';

const defaultConfig = {
  createUser,
  fetchUser,
  updateUser,
  authRules,
  secret: 'testymctestface'
};

let server;
let agent;

describe('Derelict', () => {
  describe('JWT and XSRF Tokens', () => {
    let xsrfCookie = '';

    before((done) => {
      server = setupServer(defaultConfig).listen(1337, () => {
        console.log('Server ready for testing on port 1337');
        agent = request.agent(server);
        done();
      });
    });

    after((done) => {
      server.close(done);
    });

    it('Should create tokens', done => (
      agent
        .post('/create_jwt')
        .send({ data: { a: 'test' }, testName: 'TeSt' })
        .expect((res) => {
          const cookies = res.headers['set-cookie'];
          assert.lengthOf(cookies, 2);
          assert.match(cookies[0], /X\-TEST\-JWT/);
          assert.match(cookies[1], /X\-TEST\-XSRF/);
          assert.isFalse(cookies[0].indexOf('something.com') > 0);
          assert.isFalse(cookies[0].indexOf('Secure') > 0);
          assert.isFalse(cookies[1].indexOf('something.com') > 0);
          assert.isFalse(cookies[1].indexOf('Secure') > 0);
        })
        .end((err, res) => {
          const xsrfIndex = res.headers['set-cookie'].findIndex((item) => {
            return item.indexOf('X-TEST-XSRF') > -1;
          });

          const parts = ('; ' + res.headers['set-cookie'][xsrfIndex]).split("; X-TEST-XSRF=");
          xsrfCookie = parts.pop().split(";").shift();
          done();
        })
    ));

    it('Should decode jwt tokens', done => (
      agent
        .post('/decode_jwt')
        .set({ 'X-TEST-XSRF': xsrfCookie })
        .send({ testName: 'tEsT' })
        .end((err, res) => {
          assert(res.body.token.a === 'test');
          done();
        })
    ));
  });

  describe('Authentication with XSRF', () => {
    let xsrfCookie = '';

    before((done) => {
      server = setupServer(defaultConfig).listen(1337, () => {
        console.log('Server ready for testing on port 1337');
        agent = request.agent(server);
        done();
      });
    });

    after((done) => {
      server.close(done);
    });

    it('Should let users signup', (done) => {
      agent
        .post('/signup')
        .send({ email: 'test@email.com', password: 'test' })
        .expect(200)
        .end((err, res) => {
          assert(res.body.email === 'test@email.com');
          assert(!res.body.password);
          done();
        });
    });

    it('Should call next after sign up', (done) => {
      agent
        .post('/signup')
        .send({ email: 'another@email.com', password: 'test' })
        .expect(200)
        .end((err, res) => {
          assert(res.body.email === 'another@email.com');
          assert(!res.body.password);
        });

      setTimeout(() => {
        agent
        .get('/next-called')
        .expect(200)
        .end((err, res) => {
          assert(res.body.nextCalled === true);
          done();
        });
      }, 2000);
    });

    it('Should let users login', (done) => {
      agent
        .post(`/login`)
        .send({ email: 'test@email.com', password: 'test' })
        .expect(200)
        .expect((res) => {
          const cookies = res.headers['set-cookie'];
          assert.lengthOf(cookies, 2);
          assert.match(cookies[0], /X\-ACCESS\-JWT/);
          assert.match(cookies[1], /X\-ACCESS\-XSRF/);
          assert.isFalse(cookies[0].indexOf('something.com') > 0);
          assert.isFalse(cookies[0].indexOf('Secure') > 0);
          assert.isFalse(cookies[1].indexOf('something.com') > 0);
          assert.isFalse(cookies[1].indexOf('Secure') > 0);
        })
        .end((err, res) => {
          const xsrfIndex = res.headers['set-cookie'].findIndex((item) => {
            return item.indexOf('X-ACCESS-XSRF') > -1;
          });

          const parts = ('; ' + res.headers['set-cookie'][xsrfIndex]).split("; X-ACCESS-XSRF=");
          xsrfCookie = parts.pop().split(";").shift();
          done();
        });
    });

    it('Should let users access protected routes', (done) => {
      agent
        .get('/pass_auth')
        .set({ 'X-ACCESS-XSRF': xsrfCookie })
        .expect(200, done);
    });

    it('Should block users from accessing route above their pay-grade', (done) => {
      agent
        .get('/fail_auth')
        .set({ 'X-ACCESS-XSRF': xsrfCookie })
        .expect(401, done);
    });

    it('Should clear cookies when users logout', (done) => {
      agent
        .post('/logout')
        .expect(200)
        .end((err, res) => {
          const cookies = res.headers['set-cookie'];
          assert.lengthOf(cookies, 2);
          assert.match(cookies[0], /X\-ACCESS\-JWT/);
          assert.match(cookies[1], /X\-ACCESS\-XSRF/);
          assert.match(cookies[0], /Expires/);
          assert.match(cookies[1], /Expires/);
          done();
        });
    });

    it('Should let users change their password', (done) => {
      agent
        .put('/change-pass')
        .send({ id: 4, password: 'test', new_password: 'newtest' })
        .expect(200)
        .end((err, res) => {
          assert(res.body.email === 'test@email.com');
          assert(!res.body.password);

          agent
            .post(`/login`)
            .send({ email: 'test@email.com', password: 'newtest' })
            .expect(200)
            .end(() => {
              done();
            });
        });
    });

    it('Should let users reset their password', (done) => {
      agent
        .put('/reset-pass')
        .send({ id: 4 })
        .expect(200)
        .end((err, res) => {

          agent
            .post('/login')
            .send({ email: 'test@email.com', password: 'newtest' })
            .expect(400)
            .end(() => done());
        });
    });
  });

  describe('Handle sslDomain Setting', () => {
    before((done) => {
      const sslConfig = { ...defaultConfig, sslDomain: 'something.com' };

      server = setupServer(sslConfig).listen(1337, () => {
        console.log('Server ready for testing on port 1337');
        agent = request.agent(server);
        done();
      });
    });

    after((done) => {
      server.close(done);
    });

    it('Should set Domain and Secure directive when sslDomain is given', (done) => {
      agent
        .post('/signup')
        .send({ email: 'test@email.com', password: 'test' })
        .expect(200)
        .expect((res) => {
          const cookies = res.headers['set-cookie'];
          assert.isTrue(cookies[0].indexOf('something.com') > 0);
          assert.isTrue(cookies[0].indexOf('Secure') > 0);
          assert.isTrue(cookies[1].indexOf('something.com') > 0);
          assert.isTrue(cookies[1].indexOf('Secure') > 0);
        })
        .end(() => done());
    });

    it('Should clear cookies when users logout when sslDomain is given', (done) => {
      agent
        .post('/logout')
        .expect(200)
        .end((err, res) => {
          const cookies = res.headers['set-cookie'];
          assert.lengthOf(cookies, 2);
          assert.isTrue(cookies[0].indexOf('something.com') > 0);
          assert.isTrue(cookies[1].indexOf('something.com') > 0);
          assert.match(cookies[0], /X\-ACCESS\-JWT/);
          assert.match(cookies[1], /X\-ACCESS\-XSRF/);
          assert.match(cookies[0], /Expires/);
          assert.match(cookies[1], /Expires/);
          done();
        });
    });
  });
});
