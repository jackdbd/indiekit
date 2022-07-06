import process from "node:process";
import test from "ava";
import nock from "nock";
import supertest from "supertest";
import { JSDOM } from "jsdom";
import { testServer } from "@indiekit-test/server";
import { cookie } from "@indiekit-test/session";

test("Returns share page", async (t) => {
  nock("https://token-endpoint.example").get("/").reply(200, {
    me: process.env.TEST_PUBLICATION_URL,
    scope: "create",
  });

  const server = await testServer();
  const request = supertest.agent(server);
  const response = await request.get("/share").set("cookie", [cookie]);
  const dom = new JSDOM(response.text);
  const result = dom.window.document.querySelector("title").textContent;

  t.is(result, "Share - Test configuration");

  server.close(t);
});