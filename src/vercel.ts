import { handle } from "hono/vercel";
import app from "./server.js";

export default handle(app);