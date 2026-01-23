const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path'); // <--- MUDANÇA 1: Importar gerenciador de pastas

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// --- MUDANÇA 2: CONFIGURAÇÃO PARA ABRIR O SITE ---
// Isso diz para o servidor: "Quando alguém entrar na home, mostre os arquivos da pasta de trás"
// (Onde estão seu index.html, admin.html e a logo)
app.use(express.static(path.join(__dirname, '../')));

// --- BANCO DE DADOS (Simulado na memória) ---
let produtos = [
    { id: 1, name: "Scooter X13 Pro", description: "Urbana e rápida.", price: 4500.00, image: "Foto X13" },
    { id: 2, name: "E-Bike V10 Sport", description: "Potência total.", price: 6200.00, image: "Foto V10" }
];

let pedidos = []; 

// --- ROTAS DA LOJA (Cliente) ---

// Rota para o site pegar os produtos
app.get('/api/produtos', (req, res) => res.json(produtos));

// Rota para fechar o pedido
app.post('/api/checkout', (req, res) => {
    const novoPedido = {
        id: Date.now(),
        data: new Date().toLocaleString(),
        itens: req.body.itens,
        total: req.body.total
    };
    pedidos.push(novoPedido);
    console.log('Novo pedido recebido!');
    res.json({ message: 'Pedido realizado com sucesso!' });
});

// --- ROTAS DO SISTEMA (Admin) ---

// 1. Ver todos os pedidos
app.get('/api/pedidos', (req, res) => res.json(pedidos));

// 2. Adicionar novo produto (Pelo Admin)
app.post('/api/produtos', (req, res) => {
    const produto = req.body;
    produto.id = Date.now(); // Gera ID automático
    produtos.push(produto);
    res.json({ message: "Produto adicionado!" });
});

// 3. Deletar produto (Pelo Admin)
app.delete('/api/produtos/:id', (req, res) => {
    const id = parseInt(req.params.id);
    produtos = produtos.filter(p => p.id !== id);
    res.json({ message: "Produto removido!" });
});

// Iniciar o Servidor
app.listen(PORT, () => {
    console.log(`Sistema rodando!`);
    console.log(`Acesse a Loja: http://localhost:${PORT}`);
    console.log(`Acesse o Admin: http://localhost:${PORT}/admin.html`);
});