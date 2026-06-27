import { jest } from "@jest/globals";
import request from "supertest";

const mockExecute = jest.fn();

jest.unstable_mockModule("../config/database.js", () => ({
  pool: {
    execute: mockExecute,
  },
}));

jest.unstable_mockModule("bcrypt", () => ({
  default: {
    compare: jest.fn(),
    hash: jest.fn(),
  },
}));

jest.unstable_mockModule("jsonwebtoken", () => ({
  default: {
    sign: jest.fn((payload, secret, options) => {
      if (options && options.expiresIn === "15m") return "access_token_test";
      if (options && options.expiresIn === "30d") return "refresh_token_test";
      return "token_test";
    }),
    verify: jest.fn((token, secret, callback) => {
      if (token === "refresh_token_test") {
        callback(null, { id: 1, nombre: "Juan", rol: "cliente" });
      } else {
        callback(new Error("Invalid token"));
      }
    })
  },
}));

const { default: app } = await import("../index.js");

const bcrypt = (await import("bcrypt")).default;

describe("Auth API", () => {
  test("Debe rechazar login sin datos", async () => {
    const response = await request(app).post("/api/auth/login").send({});

    expect(response.statusCode).toBe(400);

    expect(response.body.error).toBe("Email y contraseña son obligatorios");
  });

  test("Login usuario inexistente", async () => {
    mockExecute.mockResolvedValueOnce([[]]);

    const response = await request(app).post("/api/auth/login").send({
      email: "fake@test.com",
      password: "123",
    });

    expect(response.statusCode).toBe(401);
  });

  test("Login correcto", async () => {
    mockExecute.mockResolvedValueOnce([
      [
        {
          id: 1,
          nombre: "Juan",
          email: "juan@test.com",
          rol: "cliente",
          password_hash: "hash",
          activo: 1,
        },
      ],
    ]);

    bcrypt.compare.mockResolvedValue(true);

    const response = await request(app).post("/api/auth/login").send({
      email: "juan@test.com",
      password: "123",
    });

    expect(response.statusCode).toBe(200);

    expect(response.body.accessToken).toBe("access_token_test");
    expect(response.body.refreshToken).toBe("refresh_token_test");
  });

  test("Registro sin campos", async () => {
    const response = await request(app).post("/api/auth/register").send({
      email: "test@test.com",
    });

    expect(response.statusCode).toBe(400);
  });

  test("Registro correo existente", async () => {
    mockExecute.mockResolvedValueOnce([
      [
        {
          id: 1,
        },
      ],
    ]);

    const response = await request(app).post("/api/auth/register").send({
      nombre: "Ana",
      email: "ana@test.com",
      password: "123",
    });

    expect(response.statusCode).toBe(409);
  });

  test("Registro correcto", async () => {
    mockExecute

      .mockResolvedValueOnce([[]])

      .mockResolvedValueOnce([
        {
          insertId: 10,
        },
      ]);

    bcrypt.hash.mockResolvedValue("hash");

    const response = await request(app).post("/api/auth/register").send({
      nombre: "Pedro",
      email: "pedro@test.com",
      password: "123",
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.accessToken).toBe("access_token_test");
    expect(response.body.refreshToken).toBe("refresh_token_test");
  });
  test("Refresh token válido emite nuevo access token", async () => {
    const response = await request(app).post("/api/auth/refresh").send({
      refreshToken: "refresh_token_test"
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.accessToken).toBe("access_token_test");
  });

  test("Refresh token inválido es rechazado", async () => {
    const response = await request(app).post("/api/auth/refresh").send({
      refreshToken: "invalid_token"
    });
    expect(response.statusCode).toBe(403);
  });
});
