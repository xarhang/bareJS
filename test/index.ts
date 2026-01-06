import { BareJS, logger } from '../src'; // Adjust path to your BareJS file
import { staticFile } from '../src/static';

const app = new BareJS();

// 1. Logger FIRST so it sees everything
app.use(logger); 

// 2. StaticFile SECOND to catch files before they 404
app.use(staticFile('public'));

// 3. Routes LAST
app.get('/hello', () => ({ message: "API is working" }));

app.listen(3000);