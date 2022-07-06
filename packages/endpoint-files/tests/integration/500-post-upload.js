import process from "node:process";
import test from "ava";
import nock from "nock";
import supertest from "supertest";
import { JSDOM } from "jsdom";
import { getFixture } from "@indiekit-test/fixtures";
import { testServer } from "@indiekit-test/server";
import { cookie } from "@indiekit-test/session";

test("Returns 500 error uploading file", async (t) => {
  nock("https://token-endpoint.example").get("/").reply(200, {
    me: process.env.TEST_PUBLICATION_URL,
    scope: "create",
  });
  nock("https://api.github.com")
    .put((uri) => uri.includes(".jpg"))
    .reply(500, "Something went wrong");

  // Upload file
  const server = await testServer();
  const request = supertest.agent(server);
  const response = await request
    .post("/files/new")
    .set("cookie", [cookie])
    .attach("file", getFixture("file-types/photo.jpg", false), "photo.jpg");
  const dom = new JSDOM(response.text);
  const result = dom.window.document.querySelector(
    ".notification--error p"
  ).textContent;

  t.is(response.status, 500);
  t.is(result, "GitHub store: Something went wrong");

  server.close(t);
});