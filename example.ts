// All comments in English
import { BareJS } from './src/bare';
import { typebox, native } from './src/validators';
import * as TB from '@sinclair/typebox';
import { logger } from './src/logger';
// Import types for explicit annotation
import type { Context } from './src/context';
import { BareRouter } from './src/router';
import { createToken, bareAuth } from './src';

const app = new BareJS();

// Global Middleware
app.use(logger);

// Create Schema with TypeBox
const UserSchema = TB.Type.Object({
  name: TB.Type.String(),
  age: TB.Type.Number()
});

// ✅ Route 1: Using TypeBox Validator
// Annotating 'req' as Context (which is an alias for Request)
app.post('/users-tb', typebox(UserSchema), (req: Context) => {
  return { 
    message: "Saved via TypeBox", 
    user: (req as any).parsedBody 
  };
});

// ✅ Route 2: Using Native Validator
app.post('/users-native', native(UserSchema), (req: Context) => {
  return { 
    message: "Saved via Native", 
    user: (req as any).parsedBody 
  };
});

// ✅ Route 3: Pure speed
app.get('/', () => ({ message: "Welcome to BareJS!" }));

app.get('/ping', () => {({ message: "pong" })});

// ✅ Dynamic Path: Explicitly type 'req' and 'params'
app.get('/user/:id', (ctx: Context) => {
  const userId = ctx.params.id;
  return { user: userId, status: 'active' };
});

// ✅ Multiple Params: Explicitly type 'req' and 'params'
app.get('/post/:category/:id', (ctx: Context) => {
  return ctx.params; 
});

const publicRoute = new BareRouter();
publicRoute.group("/api/v1", (v1) => {
  v1.get("/login", (ctx: Context) => "Login Page");
  v1.get("/status", () => "OK");
});
const SECRET = process.env.JWT_SECRET || "super-secret-key";

// --- 1. Public Auth Router ---
const authRouter = new BareRouter("/auth");

authRouter.post("/login", async (ctx: Context) => {
  // Logic to check DB password here...
  const token = await createToken({ id: 1, name: "Admin" }, SECRET);
  return { token };
});

// --- 2. Protected Data Router ---
// Pass your bareAuth middleware directly to the constructor
const protectedRoute = new BareRouter("", [bareAuth(SECRET)]);

protectedRoute.group("/api/v1", (v1) => {
  v1.get("/me", (ctx: Context) => {
    // ctx.get('user') works because of ctx.set('user', ...) in bareAuth
    return { user: ctx.get('user') };
  });

  v1.get("/dashboard", (ctx: Context) => ({ stats: [10, 20, 30] }));
});

// --- 3. Mount ---
app.use(authRouter);
app.use(protectedRoute);
// Use process.env for deployment as requested
const HOST = process.env.HOST || "10.62.0.72";
const PORT = parseInt(process.env.PORT || "3000");

app.listen(HOST, PORT);