import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import { authenticateToken } from "../middleware/auth.js";

describe("Middleware de Autenticación (authenticateToken)", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      headers: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
    process.env.JWT_SECRET = "test_secret_key";
  });

  test("Debe retornar 401 si no se proporciona el token", () => {
    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Acceso denegado, token no proporcionado",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("Debe retornar 403 si el token es inválido", () => {
    req.headers["authorization"] = "Bearer token_invalido";

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Token inválido o expirado",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("Debe retornar 403 si el token está expirado", () => {
    // Generar un token ya expirado con tiempo en el pasado (-10 segundos)
    const expiredToken = jwt.sign(
      { id: 1, nombre: "Test User" },
      process.env.JWT_SECRET,
      { expiresIn: "-10s" }
    );

    req.headers["authorization"] = `Bearer ${expiredToken}`;

    authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Token inválido o expirado",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("Debe llamar a next() y adjuntar req.user si el token es válido", () => {
    const validToken = jwt.sign(
      { id: 1, nombre: "Juan", rol: "cliente" },
      process.env.JWT_SECRET,
      { expiresIn: "15m" }
    );

    req.headers["authorization"] = `Bearer ${validToken}`;

    authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.nombre).toBe("Juan");
    expect(req.user.rol).toBe("cliente");
  });
});
