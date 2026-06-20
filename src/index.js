import express from "express";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.js";
import citasRoutes from "./routes/citas.js";
import servicesRoutes from "./routes/services.js";
import mascotasRoutes from "./routes/mascotas.js";
import usersRoutes from "./routes/users.js";
dotenv.config();

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    mensaje: "Bienvenido a la API Veterinaria Antioquia",
  });
});

app.use("/api/auth", authRoutes);

app.use("/api/citas", citasRoutes);
app.use("/api/servicios", servicesRoutes);
app.use("/api/mascotas", mascotasRoutes);
app.use("/api/usuarios", usersRoutes);
export default app;
