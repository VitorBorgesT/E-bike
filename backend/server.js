const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { MercadoPagoConfig, Preference } = require('mercadopago');

const app = express();
const PORT = 3000;
// COLE SEU TOKEN DO MERCADO PAGO AQUI
const client = new MercadoPagoConfig({ accessToken: 'SEU_ACCESS_TOKEN_AQUI' });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- BANCO DE DADOS ---
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error(err.message);
    else console.log('Banco de Dados Conectado.');
});

function generateInternalCode(prefix) {
    return prefix + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

db.serialize(() => {
    // Produtos
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, name TEXT, price REAL, description TEXT, image TEXT
    )`);
    // Configurações (Banner)
    db.run(`CREATE TABLE IF NOT EXISTS site_config (key TEXT PRIMARY KEY, value TEXT)`);
    // Pedidos e Sessões
    db.run(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id INTEGER, data TEXT, itens TEXT, total REAL, status TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER)`);
    
    // USUÁRIOS (COM NOVA COLUNA 'ROLE')
    // role pode ser 'user' ou 'admin'
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        code TEXT, 
        name TEXT, 
        email TEXT UNIQUE, 
        password TEXT,
        role TEXT DEFAULT 'user' 
    )`);
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// --- GESTÃO DE USUÁRIOS (NOVO) ---
app.get('/api/users', (req, res) => {
    // Lista todos os usuários (senha oculta)
    db.all("SELECT id, code, name, email, role FROM users", [], (err, rows) => res.json(rows));
});

// Promover ou Rebaixar usuário
app.put('/api/users/:id/role', (req, res) => {
    const { role } = req.body; // 'admin' ou 'user'
    db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, req.params.id], function(err) {
        if(err) return res.status(500).json({error: err.message});
        res.json({ message: `Cargo alterado para ${role}` });
    });
});

app.delete('/api/users/:id', (req, res) => {
    db.run(`DELETE FROM users WHERE id = ?`, req.params.id, () => res.json({ message: "Usuário deletado" }));
});

// --- ROTA DE BANNER ---
app.post('/api/config/banner', upload.single('image'), (req, res) => {
    const imagePath = req.file ? `/uploads/${req.file.filename}` : '';
    if(!imagePath) return res.status(400).json({error: 'Sem imagem'});
    db.run(`INSERT INTO site_config (key, value) VALUES ('hero_image', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [imagePath], 
    (err) => res.json({ message: "Atualizado", image: imagePath }));
});
app.get('/api/config/banner', (req, res) => {
    db.get(`SELECT value FROM site_config WHERE key = 'hero_image'`, [], (err, row) => res.json({ image: row ? row.value : '' }));
});

// --- PRODUTOS ---
app.get('/api/produtos', (req, res) => { db.all("SELECT * FROM products", [], (err, rows) => res.json(rows)); });
app.post('/api/produtos', upload.single('image'), (req, res) => {
    const { name, price, description } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : '';
    const code = generateInternalCode('PROD');
    db.run(`INSERT INTO products (code, name, price, description, image) VALUES (?, ?, ?, ?, ?)`, 
        [code, name, price, description, imagePath], (err) => res.json({ message: "Criado", code })
    );
});
app.delete('/api/produtos/:id', (req, res) => { db.run(`DELETE FROM products WHERE id = ?`, req.params.id, () => res.json({ message: "Deletado" })); });

// --- AUTH (LOGIN E REGISTER COM ROLE) ---
app.post('/api/register', (req, res) => {
    const { name, email, password } = req.body;
    const hash = bcrypt.hashSync(password, 10);
    const code = generateInternalCode('USER');
    
    // O primeiro usuário criado será ADMIN automaticamente para facilitar? 
    // Vamos manter padrão 'user', você altera no painel depois, ou editamos no banco.
    // Dica: Se quiser que o PRIMEIRO seja admin, precisaria de uma lógica extra, mas vamos pelo painel.
    
    db.run(`INSERT INTO users (code, name, email, password, role) VALUES (?, ?, ?, ?, 'user')`, [code, name, email, hash], function(err) {
        if (err) return res.status(400).json({ error: 'Email já existe' });
        const token = uuidv4();
        const userId = this.lastID;
        db.run(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`, [token, userId], () => {
            // Retorna a role também
            res.json({ message: 'Sucesso', token, name, code, role: 'user' });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) return res.status(400).json({ error: 'Erro no login' });
        const token = uuidv4();
        db.run(`INSERT INTO sessions (token, user_id) VALUES (?, ?)`, [token, user.id]);
        // Retorna se ele é admin ou não
        res.json({ token, name: user.name, role: user.role });
    });
});

// --- CHECKOUT ---
app.post('/api/checkout', async (req, res) => {
    const { itens, total, token } = req.body;
    let userId = null;
    if (token) {
        const session = await new Promise(resolve => db.get(`SELECT user_id FROM sessions WHERE token = ?`, [token], (err, row) => resolve(row)));
        if(session) userId = session.user_id;
    }
    try {
        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: itens.map(i => ({ title: i.name, unit_price: Number(i.price), quantity: Number(i.qty), currency_id: 'BRL' })),
                back_urls: { success: `http://localhost:${PORT}`, failure: `http://localhost:${PORT}`, pending: `http://localhost:${PORT}` },
                auto_return: 'approved'
            }
        });
        db.run(`INSERT INTO orders (id, user_id, data, itens, total, status) VALUES (?, ?, ?, ?, ?, ?)`, 
            [result.id || Date.now().toString(), userId, new Date().toLocaleString(), JSON.stringify(itens), total, 'Pendente']);
        res.json({ url: result.sandbox_init_point });
    } catch (error) { res.status(500).json({ error: "Erro" }); }
});

app.get('/api/pedidos', (req, res) => {
    db.all(`SELECT orders.*, users.name as user_name, users.code as user_code FROM orders LEFT JOIN users ON orders.user_id = users.id`, [], (err, rows) => {
        res.json(rows.map(p => ({...p, itens: JSON.parse(p.itens)})));
    });
});

app.listen(PORT, () => console.log(`Rodando em http://localhost:${PORT}`));