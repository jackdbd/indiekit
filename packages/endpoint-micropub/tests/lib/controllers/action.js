import 'dotenv/config.js'; // eslint-disable-line import/no-unassigned-import
import test from 'ava';
import nock from 'nock';
import {server} from '@indiekit-test/server';

test.beforeEach(async t => {
  const request = await server;
  t.context.request = request.post('/micropub');
});

test.serial('Creates post (form-encoded)', async t => {
  const authScope = nock('https://tokens.indieauth.com')
    .get('/token')
    .reply(200, {
      me: process.env.TEST_PUBLICATION_URL,
      scope: 'create'
    });
  const hostScope = nock('https://api.github.com')
    .put(uri => uri.includes('foobar'))
    .reply(200, {commit: {message: 'Message'}});
  const response = await t.context.request
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${process.env.TEST_BEARER_TOKEN}`)
    .send('h=entry')
    .send('name=Foobar')
    .send('content=Micropub+test+of+creating+an+h-entry+with+categories')
    .send('photo=https%3A%2F%2Fwebsite.example%2Fphoto.jpg')
    .send('category[]=test1&category[]=test2');
  t.is(response.statusCode, 202);
  t.regex(response.headers.location, /\bfoobar\b/);
  t.regex(response.body.success_description, /\bPost will be created\b/);
  authScope.done();
  hostScope.done();
});

test.serial('Creates post (JSON)', async t => {
  const authScope = nock('https://tokens.indieauth.com')
    .get('/token')
    .reply(200, {
      me: process.env.TEST_PUBLICATION_URL,
      scope: 'create'
    });
  const hostScope = nock('https://api.github.com')
    .put(uri => uri.includes('foobar'))
    .reply(200, {commit: {message: 'Message'}});
  const response = await t.context.request
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${process.env.TEST_BEARER_TOKEN}`)
    .send({
      type: ['h-entry'],
      properties: {
        name: ['Foobar'],
        content: ['Micropub test of creating an h-entry with a JSON request containing multiple categories.'],
        photo: [{
          value: 'https://website.example/photo.jpg',
          alt: 'Example photo'
        }],
        category: ['test1', 'test2']
      }
    });
  t.is(response.statusCode, 202);
  t.regex(response.headers.location, /\bfoobar\b/);
  t.regex(response.body.success_description, /\bPost will be created\b/);
  authScope.done();
  hostScope.done();
});

test.serial('Returns 400 if access token does not provide adequate scope', async t => {
  const scope = nock('https://tokens.indieauth.com')
    .get('/token')
    .reply(200, {
      me: process.env.TEST_PUBLICATION_URL,
      scope: 'media'
    });
  const response = await t.context.request
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${process.env.TEST_BEARER_TOKEN_NOSCOPE}`);
  t.is(response.statusCode, 401);
  t.is(response.body.error_description, 'The scope of this token does not meet the requirements for this request');
  t.is(response.body.scope, 'create');
  scope.done();
});
