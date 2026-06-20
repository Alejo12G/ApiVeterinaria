import { jest } from "@jest/globals";
import request from "supertest";

// Mock del middleware de autenticación
// No usamos JWT real en estas pruebas
jest.unstable_mockModule("../middleware/auth.js", () => ({
  authenticateToken: (req, res, next) => {
    req.user = {
      id: 1,
      nombre: "Juan",
      rol: "cliente",
    };

    next();
  },
}));

// Mock de la base de datos
const mockExecute = jest.fn();

jest.unstable_mockModule("../config/database.js", () => ({
  pool: {
    execute: mockExecute,
  },
}));

// Importar la app DESPUÉS de los mocks
const { default: app } = await import("../index.js");

describe("Citas API", () => {
  test("Obtiene citas del usuario", async () => {
    mockExecute.mockResolvedValueOnce([
      [
        {
          id: 1,
          fecha: "2026-06-20T10:00:00",
          estado: "programada",
          motivo: "Consulta",
          duracionMinutos: 30,
          servicioPrecioBase: "50000",
        },
      ],
    ]);

    const response = await request(app).get("/api/citas/mias");

    expect(response.statusCode).toBe(200);

    expect(response.body.length).toBe(1);
  });

  test("No crea cita sin datos obligatorios", async () => {
    const response = await request(app).post("/api/citas").send({});

    expect(response.statusCode).toBe(400);

    expect(response.body.error).toBe(
      "Faltan datos obligatorios para agendar la cita",
    );
  });

  test("Crea cita correctamente", async () => {
    mockExecute.mockResolvedValueOnce([
      {
        insertId: 50,
      },
    ]);

    const response = await request(app).post("/api/citas").send({
      idMascota: null,
      idVeterinario: 2,
      idServicio: 1,
      fecha: "2026-06-20 10:00",
      motivo: "Vacuna",
      duracionMinutos: 30,
    });

    expect(response.statusCode).toBe(201);

    expect(response.body.id).toBe(50);

    expect(response.body.estado).toBe("programada");
  });
});
