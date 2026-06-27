import request from "supertest";
import { default as app } from "../index.js";
import { pool } from "../config/database.js";

// Para no colisionar con datos existentes, generamos identificadores únicos para la prueba
const timeStamp = Date.now();
const testClient = {
  nombre: "Test Client",
  email: `client_${timeStamp}@test.com`,
  password: "123"
};

const testVet = {
  nombre: "Test Vet",
  email: `vet_${timeStamp}@test.com`,
  password: "123"
};

const testAdmin = {
  nombre: "Test Admin",
  email: `admin_${timeStamp}@test.com`,
  password: "123"
};

let clientToken = "";
let vetToken = "";
let adminToken = "";

let idCliente = 0;
let idVet = 0;
let idAdmin = 0;

let idMascota = 0;
let idServicio = 0;
let idCita = 0;
let idDiagnostico = 0;
let idMedicamento = 0;
let idVacuna = 0;
let idEspecie = 0;
let idFactura = 0;

// Setup: Crear los usuarios con sus respectivos roles saltándonos la ruta normal para forzar el rol
beforeAll(async () => {
  const bcrypt = (await import("bcrypt")).default;
  const passwordWithKey = "123" + (process.env.PASSWORD_KEY || "");
  const saltRounds = parseInt(process.env.PASSWORD_SALT_ROUNDS || "9");
  const hash = await bcrypt.hash(passwordWithKey, saltRounds);

  const [resClient] = await pool.execute(
    "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'cliente')",
    [testClient.nombre, testClient.email, hash]
  );
  idCliente = resClient.insertId;

  const [resVet] = await pool.execute(
    "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'veterinario')",
    [testVet.nombre, testVet.email, hash]
  );
  idVet = resVet.insertId;
  await pool.execute(
    "INSERT INTO veterinarios (id_usuario, especialidad, licencia_profesional) VALUES (?, 'General', 'LIC-123')",
    [idVet]
  );

  const [resAdmin] = await pool.execute(
    "INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, 'administrador')",
    [testAdmin.nombre, testAdmin.email, hash]
  );
  idAdmin = resAdmin.insertId;
  
  // Crear datos maestros dinámicos
  const [resEsp] = await pool.execute("INSERT INTO especies (nombre_comun, nombre_cientifico) VALUES ('Especie Test', 'Test E2E')");
  idEspecie = resEsp.insertId;

  const [resServ] = await pool.execute("INSERT INTO servicios (nombre, descripcion, categoria, precio_base, duracion_estimada_min) VALUES ('Servicio Test', 'Test E2E', 'clinica', 50000, 30)");
  idServicio = resServ.insertId;

  const [resMed] = await pool.execute("INSERT INTO medicamentos (nombre, descripcion, tipo, precio) VALUES ('Med Test', 'Test E2E', 'Píldora', 500)");
  idMedicamento = resMed.insertId;
  await pool.execute("INSERT INTO inventarios (id_medicamento, cantidad, lote, fecha_vencimiento) VALUES (?, 100, 'LOTE1', '2030-01-01')", [idMedicamento]);

  const [resVac] = await pool.execute("INSERT INTO vacunas (nombre, descripcion, duracion_proteccion_meses) VALUES ('Vacuna Test', 'Test E2E', 12)");
  idVacuna = resVac.insertId;
});

// Teardown: Limpiar la BD de los datos de prueba
afterAll(async () => {
  try { await pool.execute("DELETE FROM factura_detalles WHERE id_factura = ?", [idFactura]); } catch(e){}
  try { await pool.execute("DELETE FROM facturas WHERE id = ?", [idFactura]); } catch(e){}
  try { await pool.execute("DELETE FROM vacunaciones WHERE id_mascota = ?", [idMascota]); } catch(e){}
  try { await pool.execute("DELETE FROM tratamientos WHERE id_diagnostico = ?", [idDiagnostico]); } catch(e){}
  try { await pool.execute("DELETE FROM diagnosticos WHERE id = ?", [idDiagnostico]); } catch(e){}
  try { await pool.execute("DELETE FROM citas WHERE id = ?", [idCita]); } catch(e){}
  try { await pool.execute("DELETE FROM mascotas WHERE id = ?", [idMascota]); } catch(e){}
  try { await pool.execute("DELETE FROM notificaciones WHERE id_usuario = ?", [idCliente]); } catch(e){}
  
  // Limpiar datos maestros de prueba
  try { await pool.execute("DELETE FROM inventarios WHERE id_medicamento = ?", [idMedicamento]); } catch(e){}
  try { await pool.execute("DELETE FROM medicamentos WHERE id = ?", [idMedicamento]); } catch(e){}
  try { await pool.execute("DELETE FROM vacunas WHERE id = ?", [idVacuna]); } catch(e){}
  try { await pool.execute("DELETE FROM servicios WHERE id = ?", [idServicio]); } catch(e){}
  try { await pool.execute("DELETE FROM especies WHERE id = ?", [idEspecie]); } catch(e){}

  await pool.execute("DELETE FROM usuarios WHERE id IN (?, ?, ?)", [idCliente, idVet, idAdmin]);
  await pool.end(); // Cerrar el pool para que Jest termine
});

describe("Ejecución E2E de los 10 Casos de Prueba (TC-001 al TC-010)", () => {

  // ==========================================
  // TC-001: Inicio de sesión exitoso
  // ==========================================
  test("TC-001: Login de Usuarios", async () => {
    // Login Cliente
    const resClient = await request(app).post("/api/auth/login").send({ email: testClient.email, password: testClient.password });
    expect(resClient.statusCode).toBe(200);
    expect(resClient.body.accessToken).toBeDefined();
    clientToken = resClient.body.accessToken;

    // Login Vet
    const resVet = await request(app).post("/api/auth/login").send({ email: testVet.email, password: testVet.password });
    expect(resVet.statusCode).toBe(200);
    vetToken = resVet.body.accessToken;

    // Login Admin
    const resAdmin = await request(app).post("/api/auth/login").send({ email: testAdmin.email, password: testAdmin.password });
    expect(resAdmin.statusCode).toBe(200);
    adminToken = resAdmin.body.accessToken;
  });

  // ==========================================
  // TC-002: Registro de nueva mascota
  // ==========================================
  test("TC-002: Crear Mascota (Cliente)", async () => {
    const response = await request(app)
      .post("/api/mascotas")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({
        nombre: "Fido Test",
        idEspecie: idEspecie,
        fechaNacimiento: "2020-01-01",
        sexo: "macho",
        esterilizado: true
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.id).toBeDefined();
    idMascota = response.body.id;
  });

  // ==========================================
  // TC-003: Programación de cita veterinaria
  // ==========================================
  test("TC-003: Programar Cita", async () => {
    const fechaCita = new Date();
    fechaCita.setDate(fechaCita.getDate() + 1); // Mañana

    const response = await request(app)
      .post("/api/citas")
      .set("Authorization", `Bearer ${clientToken}`)
      .send({
        idMascota: idMascota,
        idVeterinario: idVet,
        idServicio: idServicio,
        fecha: fechaCita.toISOString(),
        duracionMinutos: 30,
        motivo: "Revisión general E2E"
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.estado).toBe("programada");
    expect(response.body.id).toBeDefined();
    idCita = response.body.id;
  });

  // ==========================================
  // TC-004: Registro de diagnóstico
  // ==========================================
  test("TC-004: Registro de Diagnóstico (Veterinario)", async () => {
    const response = await request(app)
      .post("/api/diagnosticos")
      .set("Authorization", `Bearer ${vetToken}`)
      .send({
        citaId: idCita,
        sintomas: "Fiebre leve y desánimo",
        diagnostico: "Infección viral leve",
        observaciones: "Requiere reposo"
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.id).toBeDefined();
    idDiagnostico = response.body.id;

    // Verificar que la cita pasó a 'completada'
    const [citas] = await pool.execute("SELECT estado FROM citas WHERE id = ?", [idCita]);
    expect(citas[0].estado).toBe("completada");
  });

  // ==========================================
  // TC-005 & TC-007: Tratamiento y Descuento de Stock
  // ==========================================
  test("TC-005 y TC-007: Asignación de tratamiento y descuento en inventario", async () => {
    // 1. Obtener stock actual antes del tratamiento
    const [invPrev] = await pool.execute("SELECT cantidad FROM inventarios WHERE id_medicamento = ?", [idMedicamento]);
    const stockInicial = invPrev[0]?.cantidad || 0;

    // 2. Crear tratamiento (TC-005)
    const response = await request(app)
      .post("/api/tratamientos")
      .set("Authorization", `Bearer ${vetToken}`)
      .send({
        idDiagnostico: idDiagnostico,
        idMedicamento: idMedicamento,
        dosis: "1 pastilla",
        frecuencia: "Cada 8 horas",
        duracionDias: 5,
        fechaInicio: new Date().toISOString().split("T")[0]
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.estado).toBe("activo");

    // 3. Verificar reducción de stock (TC-007)
    const [invPost] = await pool.execute("SELECT cantidad FROM inventarios WHERE id_medicamento = ?", [idMedicamento]);
    const stockFinal = invPost[0]?.cantidad || 0;
    
    expect(stockFinal).toBeLessThan(stockInicial); // El stock debió disminuir
  });

  // ==========================================
  // TC-006: Aplicación de vacuna
  // ==========================================
  test("TC-006: Aplicación de vacuna (Veterinario)", async () => {
    const response = await request(app)
      .post("/api/vacunas/aplicar")
      .set("Authorization", `Bearer ${vetToken}`)
      .send({
        idMascota: idMascota,
        idVacuna: idVacuna,
        fechaAplicacion: new Date().toISOString().split("T")[0],
        lote: "LOTE-E2E"
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.fechaProximaDosis).toBeDefined(); // Calcula próxima fecha
  });

  // ==========================================
  // TC-008: Generación de factura
  // ==========================================
  test("TC-008: Generación de factura de atención (Admin)", async () => {
    const response = await request(app)
      .post("/api/facturas")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idCita: idCita
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.estado).toBe("pendiente");
    expect(response.body.total).toBeGreaterThan(0); // Calculó subtotal e impuestos
    idFactura = response.body.id;
  });

  // ==========================================
  // TC-009: Pago de factura
  // ==========================================
  test("TC-009: Actualización de pago de factura (Admin)", async () => {
    const response = await request(app)
      .patch(`/api/facturas/${idFactura}/pagar`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        metodoPago: "tarjeta"
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.estado).toBe("pagada");
  });

  // ==========================================
  // TC-010: Notificaciones al cliente
  // ==========================================
  test("TC-010: Generación de notificaciones al cliente", async () => {
    // Al finalizar el diagnóstico (TC-004) y crear la factura (TC-008), 
    // se debieron generar notificaciones para el cliente.
    const response = await request(app)
      .get("/api/notificaciones")
      .set("Authorization", `Bearer ${clientToken}`);

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    
    // Verificamos que existan notificaciones y que estén como no leídas (0/false)
    const tieneNotificaciones = response.body.length > 0;
    expect(tieneNotificaciones).toBe(true);

    if (tieneNotificaciones) {
      const noLeida = response.body.find(n => n.leida === false);
      expect(noLeida).toBeDefined();
    }
  });

});
