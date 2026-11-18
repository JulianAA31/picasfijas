const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.static('public'));

// ---------- Almacenamiento en memoria ----------
const players = new Map(); // playerId -> { id, name }
const games   = new Map(); // gameId   -> game

// ---------- Utilidades ----------
function numeroValido(numero) {
  const s = String(numero ?? '');
  if (!/^\d{4}$/.test(s)) return false;
  if (new Set(s).size !== 4) return false;
  return true;
}

function calcularPicasFijas(secreto, intento) {
  let fijas = 0, picas = 0;
  for (let i = 0; i < 4; i++) {
    if (intento[i] === secreto[i]) fijas++;
    else if (secreto.includes(intento[i])) picas++;
  }
  return { fijas, picas };
}

function vistaPublica(g) {
  return {
    id: g.id,
    estado: g.estado,
    creador: g.creador,
    turno: g.turno,
    ganador: g.ganador,
    jugadores: g.jugadores.map(j => ({ id: j.id, name: j.name, intentos: j.intentos })),
    creado: g.creado
  };
}

// ---------- Health (Kubernetes lo usará) ----------
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/ready',  (_req, res) => res.json({ status: 'ready' }));

// ---------- POST /login ----------
app.post('/login', (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name requerido' });
  }
  const player = { id: uuidv4(), name: name.trim() };
  players.set(player.id, player);
  res.status(201).json(player);
});

// ---------- POST /juego (crear) ----------
app.post('/juego', (req, res) => {
  const { playerId, numero } = req.body || {};
  const player = players.get(playerId);
  if (!player) return res.status(401).json({ error: 'jugador no registrado. Use /login' });
  if (!numeroValido(numero)) {
    return res.status(400).json({ error: 'numero invalido: 4 digitos distintos, sin letras' });
  }
  const id = uuidv4().slice(0, 8);
  const game = {
    id, estado: 'iniciado',
    creador: { id: player.id, name: player.name },
    jugadores: [{ id: player.id, name: player.name, numero: String(numero), intentos: [] }],
    turno: null, ganador: null, creado: new Date().toISOString()
  };
  games.set(id, game);
  res.status(201).json(vistaPublica(game));
});

// ---------- PUT /juego/:id (unirse) ----------
app.put('/juego/:id', (req, res) => {
  const game = games.get(req.params.id);
  if (!game) return res.status(404).json({ error: 'juego no encontrado' });
  if (game.estado !== 'iniciado') return res.status(409).json({ error: 'el juego ya inicio o termino' });

  const { playerId, numero } = req.body || {};
  const player = players.get(playerId);
  if (!player) return res.status(401).json({ error: 'jugador no registrado. Use /login' });
  if (!numeroValido(numero)) return res.status(400).json({ error: 'numero invalido: 4 digitos distintos, sin letras' });
  if (game.jugadores.some(j => j.id === playerId)) return res.status(409).json({ error: 'ya estas en este juego' });
  if (game.jugadores.length >= 2) return res.status(409).json({ error: 'juego lleno' });

  game.jugadores.push({ id: player.id, name: player.name, numero: String(numero), intentos: [] });
  game.estado = 'en_juego';
  game.turno = game.jugadores[Math.floor(Math.random() * 2)].id;
  res.json(vistaPublica(game));
});

// ---------- POST /juego/:id/jugar ----------
app.post('/juego/:id/jugar', (req, res) => {
  const game = games.get(req.params.id);
  if (!game) return res.status(404).json({ error: 'juego no encontrado' });
  if (game.estado !== 'en_juego') return res.status(409).json({ error: 'el juego no esta en curso' });

  const { playerId, numero } = req.body || {};
  const jugador = game.jugadores.find(j => j.id === playerId);
  if (!jugador) return res.status(403).json({ error: 'no participas en este juego' });
  if (game.turno !== playerId) return res.status(409).json({ error: 'no es tu turno' });
  if (!numeroValido(numero)) return res.status(400).json({ error: 'numero invalido: 4 digitos distintos, sin letras' });

  const oponente = game.jugadores.find(j => j.id !== playerId);
  const { fijas, picas } = calcularPicasFijas(oponente.numero, String(numero));
  jugador.intentos.push({ numero: String(numero), fijas, picas, fecha: new Date().toISOString() });

  let ganador = null;
  if (fijas === 4) {
    game.estado = 'terminado';
    game.ganador = { id: jugador.id, name: jugador.name };
    game.turno = null;
    ganador = game.ganador;
  } else {
    game.turno = oponente.id;
  }
  res.json({ fijas, picas, turno: game.turno, estado: game.estado, ganador });
});

// ---------- GET /juego/:id ----------
app.get('/juego/:id', (req, res) => {
  const game = games.get(req.params.id);
  if (!game) return res.status(404).json({ error: 'juego no encontrado' });
  res.json(vistaPublica(game));
});

// ---------- GET /juego ----------
app.get('/juego', (req, res) => {
  const { estado } = req.query;
  const lista = [...games.values()]
    .filter(g => !estado || g.estado === estado)
    .map(g => ({
      id: g.id, estado: g.estado, creador: g.creador,
      jugadores: g.jugadores.map(j => ({ id: j.id, name: j.name })),
      ganador: g.ganador, creado: g.creado
    }));
  res.json(lista);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Picas y Fijas escuchando en :${PORT}`));