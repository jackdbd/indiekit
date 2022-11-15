import crypto from "node:crypto";
import process from "node:process";
import { IndiekitError } from "@indiekit/error";
import { fetch } from "undici";
import {
  findBearerToken,
  requestTokenValues,
  verifyTokenValues,
} from "./tokens.js";
import { generateState, validateState } from "./state.js";
import { getCanonicalUrl, randomString } from "./utils.js";

export const IndieAuth = class {
  constructor(options = {}) {
    this.codeVerifier = randomString(100);
    this.devMode = options.devMode;
    this.iv = crypto.randomBytes(16);
    this.me = getCanonicalUrl(options.me);
  }

  /**
   * Get authentication URL
   *
   * @param {string} authorizationEndpoint - Authorization endpoint
   * @param {string} state - State
   * @returns {Promise|string} Authentication URL
   */
  async getAuthUrl(authorizationEndpoint, state) {
    // PKCE code challenge
    const base64Digest = crypto
      .createHash("sha256")
      .update(this.codeVerifier)
      .digest("base64url");
    const codeChallenge = base64Digest.toString("base64url");

    const authUrl = new URL(authorizationEndpoint);
    authUrl.searchParams.append("client_id", this.clientId);
    authUrl.searchParams.append("code_challenge_method", "S256");
    authUrl.searchParams.append("code_challenge", codeChallenge);
    authUrl.searchParams.append("me", this.me);
    authUrl.searchParams.append("redirect_uri", this.redirectUri);
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("scope", "create update delete media");
    authUrl.searchParams.append("state", state);

    return authUrl.href;
  }

  /**
   * Exchange authorization code for access token
   *
   * @param {string} tokenEndpoint - Token endpoint
   * @param {string} code - Code received from authentication endpoint
   * @returns {Promise|object} Access token
   */
  async authorizationCodeGrant(tokenEndpoint, code) {
    const tokenUrl = new URL(tokenEndpoint);
    tokenUrl.searchParams.append("client_id", this.clientId);
    tokenUrl.searchParams.append("code", code);
    tokenUrl.searchParams.append("code_verifier", this.codeVerifier);
    tokenUrl.searchParams.append("grant_type", "authorization_code");
    tokenUrl.searchParams.append("redirect_uri", this.redirectUri);

    const endpointResponse = await fetch(tokenUrl.href, {
      method: "POST",
      headers: {
        accept: "application/json",
      },
    });

    if (!endpointResponse.ok) {
      throw await IndiekitError.fromFetch(endpointResponse);
    }

    return endpointResponse.json();
  }

  /**
   * Redirect user to IndieAuth login
   *
   * @returns {object} HTTP response
   */
  login() {
    return async (request, response) => {
      try {
        const { application, publication } = request.app.locals;
        this.clientId = getCanonicalUrl(application.url);

        const callbackUrl = `${application.url}/session/auth`;
        const { redirect } = request.query;
        this.redirectUri = redirect
          ? `${callbackUrl}?redirect=${redirect}`
          : `${callbackUrl}`;

        const state = generateState(this.clientId, this.iv);
        const authUrl = await this.getAuthUrl(
          publication.authorizationEndpoint,
          state
        );

        return response.redirect(authUrl);
      } catch (error) {
        return response.status(401).render("session/login", {
          title: response.__("session.login.title"),
          error: error.message,
        });
      }
    };
  }

  /**
   * Authorize user (i.e. check they are allowed access) by verifying
   * authorization code with token endpoint (which grants an access token).
   *
   * @returns {object} HTTP response
   */
  authorize() {
    return async (request, response) => {
      try {
        const { publication } = request.app.locals;
        const { code, redirect, state } = request.query;

        // Check redirect is to a local path
        if (redirect) {
          const validRedirect = redirect.match(/^\/[\w\d/?=&]*$/);

          if (!validRedirect) {
            throw IndiekitError.forbidden(
              response.__("ForbiddenError.invalidRedirect")
            );
          }
        }

        if (!code) {
          throw IndiekitError.badRequest(
            response.__("BadRequestError.missingParameter", "code")
          );
        }

        if (!state) {
          throw IndiekitError.badRequest(
            response.__("BadRequestError.missingParameter", "state")
          );
        }

        // Check for state mismatch
        if (!validateState(state, this.clientId, this.iv)) {
          throw IndiekitError.forbidden(
            response.__("ForbiddenError.invalidState")
          );
        }

        // Request access token
        const authorizedToken = await this.authorizationCodeGrant(
          publication.tokenEndpoint,
          code
        );

        // Check that access token is valid
        if (!authorizedToken.access_token || !authorizedToken.scope) {
          throw IndiekitError.unauthorized(
            response.__("UnauthorizedError.invalidToken")
          );
        }

        // Set session token and redirect to requested resource
        request.session.access_token = authorizedToken.access_token;
        request.session.scope = authorizedToken.scope;

        return response.redirect(redirect || "/");
      } catch (error) {
        response.status(error.status || 500);
        return response.render("session/login", {
          title: response.__("session.login.title"),
          error: error.message,
        });
      }
    };
  }

  /**
   * Authenticate user (i.e. check they are who they say they are) by
   * checking bearer token matches access token saved in current session.
   *
   * @returns {Function} Next middleware
   */
  authenticate() {
    const { devMode, me } = this;

    return async function (request, response, next) {
      if (devMode) {
        request.session.access_token = process.env.NODE_ENV;
        request.session.scope = "create update delete media";
      }

      // If have session has access token and scope, go to next middleware
      const { access_token, scope } = request.session;
      if (access_token && scope) {
        return next();
      }

      // Validate bearer token sent in request
      try {
        const { tokenEndpoint } = request.app.locals.publication;
        const bearerToken = findBearerToken(request);
        const tokenValues = await requestTokenValues(
          tokenEndpoint,
          bearerToken
        );

        // Check if token values contain a `me` value
        if (!tokenValues.me) {
          throw IndiekitError.unauthorized(
            response.__("UnauthorizedError.invalidToken")
          );
        }

        // Check that `me` in token values matches publication `me`
        const verifiedTokenValues = verifyTokenValues(me, tokenValues);
        if (!verifiedTokenValues) {
          throw IndiekitError.forbidden(
            response.__("ForbiddenError.invalidMe")
          );
        }

        request.session.access_token = bearerToken;
        request.session.scope = verifiedTokenValues.scope;

        next();
      } catch (error) {
        if (request.method === "GET") {
          return response.redirect(
            `/session/login?redirect=${request.originalUrl}`
          );
        }

        next(error);
      }
    };
  }
};
