import { BareJS, Type, bareAuth, createToken, securityHeaders, type Context } from '../src/index';

const SECRET = process.env.JWT_SECRET || 'barejs-example-secret-key';

const app = new BareJS()
  .useLog({ format: 'json' })
  .use(securityHeaders());

const users = [
  { id: 1, email: 'alice@example.com', role: 'admin', password_hash: '$argon2id$...' },
  { id: 2, email: 'bob@example.com', role: 'user', password_hash: '$argon2id$...' }
];

app.get('/health', () => ({ ok: true }));

app.post('/auth/login', {
  body: Type.Object({
    email: Type.String({ format: 'email' })
  })
}, async (ctx: Context) => {
  const user = users.find((u) => u.email === ctx.body.email);
  if (!user) return ctx.status(401).json({ error: 'Invalid credentials' });
  const token = await createToken({ sub: String(user.id), role: user.role }, SECRET, { expiresIn: '1h' });
  return ctx.json({ token });
});

app.get('/users', {
  response: Type.Array(Type.Object({
    id: Type.Number(),
    email: Type.String(),
    role: Type.String()
  }))
}, bareAuth({ secret: SECRET }), () => users);

app.docs({ title: 'BareJS Example API', version: '0.2.1' });

if (import.meta.main) {
  app.listen(Number(process.env.PORT || 3000));
}

export default app;
