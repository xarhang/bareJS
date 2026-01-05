import { BareJS } from './src/bare';
import type { Context } from './src/context';
import { typebox, native } from './src/validators';
import * as TB from '@sinclair/typebox';

const app = new BareJS();

// Create Schema with TypeBox
const UserSchema = TB.Type.Object({
  name: TB.Type.String(),
  age: TB.Type.Number()
});

// ✅ Route 1: Using TypeBox Validator (Fastest for Bun)
app.post('/users-tb', typebox(UserSchema), (ctx: Context) => {
  return ctx.json({ message: "Saved via TypeBox", user: ctx.body });
});


// ✅ Route 2: Using Native Validator (Safe alternative if TypeBox has issues)
app.post('/users-native', native(UserSchema), (ctx: Context) => {
  return ctx.json({ message: "Saved via Native", user: ctx.body });
});

// ✅ Route 3: No Validator (Pure speed, 0 ns overhead)
app.get('/ping', (ctx: Context) => ctx.json({ message: "pong" }));
// Dynamic Path
app.get('/user/:id', (ctx: Context) => {
  const userId = ctx.params.id;
  return ctx.json({ user: userId, status: 'active' });
});

// Multiple Params
app.get('/post/:category/:id', (ctx: Context) => {
  return ctx.json(ctx.params); // { category: 'tech', id: '1' }
});


app.listen('0.0.0.0', 3000);