import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { authRouter } from "./routes/auth";
import { passengerRouter } from "./routes/passenger";
import { driverRouter } from "./routes/driver";
import { adminRouter } from "./routes/admin";
import { initSockets } from "./ws/socket";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/v1/health", (_req, res) => {
  res.json({ ok: true, service: "cabrasgo-backend", region: "VI Región - Las Cabras / Lago Rapel" });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/passenger", passengerRouter);
app.use("/api/v1/driver", driverRouter);
app.use("/api/v1/admin", adminRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = Number(process.env.PORT) || 8080;
const server = createServer(app);
initSockets(server);

server.listen(PORT, () => {
  console.log(`CabrasGo backend escuchando en http://localhost:${PORT}`);
});
