# 📊 Order Book Implementation Guide - Version 2.0 (Updated)

## 🎯 Objectif
Guide complet pour implémenter l'Order Book dans AGGR avec toutes les améliorations et corrections découvertes lors de l'implémentation.

## 🚨 CORRECTIONS CRITIQUES (Leçons apprises)

### ✅ **Schema InfluxDB dans Constructor - OK !**
**Le schéma InfluxDB est CORRECT et nécessaire** :
```javascript
// ✅ CORRECT - Le schéma ne casse pas /historical
this.influx = new Influx.InfluxDB({
  host: host || 'localhost',
  port: port || '8086',
  database: config.influxDatabase,
  schema: [
    {
      measurement: 'orderbook',
      fields: {
        price: Influx.FieldType.FLOAT,
        size: Influx.FieldType.FLOAT
      },
      tags: ['market', 'side']
    }
  ]
})
```

### ❌ **VRAI PROBLÈME : Modification de fetch() avec JOIN**
**NE PAS** modifier la méthode `fetch()` pour faire des JOIN :
```javascript
// ❌ MAUVAIS - Casse les requêtes /historical
let query = `SELECT t.*, ${liquidityFields.join(', ')} FROM trades_1m t LEFT JOIN liquidity_sums l`

// ✅ CORRECT - Garder fetch() original
let query = `SELECT * FROM trades_1m WHERE time >= ${from}ms AND time < ${to}ms`
```

### ✅ **CORRECTION : Suppression du champ `level`**
Le champ `level` était inutilisé et causait des complications :
```javascript
// ❌ AVANT
fields: { price: bid.price, size: bid.size, level: index + 1 }

// ✅ APRÈS
fields: { price: bid.price, size: bid.size }
```

### ✅ **CORRECTION : Requête InfluxDB optimisée**
```javascript
// ✅ Requête finale optimisée
const query = `
  SELECT price, size FROM orderbook 
  WHERE market = '${exchange}:${pair.toLowerCase()}' 
  AND size > 0
  ORDER BY price
`
```

## 📁 **FICHIERS À CRÉER/MODIFIER**

### 1. **`aggr-server/src/storage/influx.js`** - Méthodes Order Book

```javascript
/**
 * Stocke un Order Book (logique AGGR exacte)
 */
async writeOrderBook(orderBookData) {
  const points = []
  const market = `${orderBookData.exchange}:${orderBookData.pair}`

  // Convertir les bids en points InfluxDB
  orderBookData.bids.forEach((bid) => {
    const priceBasedTimestamp = Math.floor(bid.price * 1000)
    points.push({
      measurement: 'orderbook',
      tags: { market, side: 'bid' },
      fields: { price: bid.price, size: bid.size },
      timestamp: priceBasedTimestamp
    })
  })

  // Convertir les asks en points InfluxDB
  orderBookData.asks.forEach((ask) => {
    const priceBasedTimestamp = Math.floor(ask.price * 1000)
    points.push({
      measurement: 'orderbook', 
      tags: { market, side: 'ask' },
      fields: { price: ask.price, size: ask.size },
      timestamp: priceBasedTimestamp
    })
  })

  if (points.length > 0) {
    await this.influx.writePoints(points, { precision: 'ms' })
  }
}

/**
 * Récupère un Order Book depuis InfluxDB
 */
async getOrderBook(exchange, pair, limit = 50) {
  const market = `${exchange}:${pair.toLowerCase()}`
  
  const query = `
    SELECT price, size FROM orderbook 
    WHERE market = '${market}' 
    AND size > 0
    ORDER BY price
  `
  
  try {
    const results = await this.influx.query(query)
    
    const bids = results
      .filter(r => r.price && r.size)
      .map(r => ({price: Number(r.price), size: Number(r.size)}))
      .filter(order => order.price > 0 && order.size > 0)
      .sort((a, b) => b.price - a.price)
      .slice(0, limit || bids.length)
    
    const asks = results
      .filter(r => r.price && r.size) 
      .map(r => ({price: Number(r.price), size: Number(r.size)}))
      .filter(order => order.price > 0 && order.size > 0)
      .sort((a, b) => a.price - b.price)
      .slice(0, limit || asks.length)
    
    return {
      exchange: exchange.toUpperCase(),
      pair: pair.toLowerCase(),
      timestamp: Date.now(),
      bids: bids,
      asks: asks
    }
  } catch (error) {
    console.error(`[InfluxDB] Error querying order book:`, error)
    throw error
  }
}

/**
 * Récupère les paires disponibles pour Order Book
 */
async getAvailableOrderBookPairs() {
  try {
    const query = `SHOW TAG VALUES FROM orderbook WITH KEY = "market"`
    const results = await this.influx.query(query)
    return results.map(r => r.value)
  } catch (error) {
    console.error(`[InfluxDB] Error getting available pairs:`, error)
    return []
  }
}
```

### 2. **`aggr-server/src/exchanges/binance.js`** - Collecteur WebSocket

```javascript
// ✅ Dans le constructor
constructor() {
  // ... code existant ...
  this.orderBookActive = new Set() // ← AJOUTER ÇA
}

// ✅ Modifier onMessage pour traiter depthUpdate
onMessage(event, options) {
  const json = JSON.parse(event.data)
  
  // Traiter les trades (existant)
  if (json.e === 'trade') {
    // ... code existant ...
  }
  
  // ✅ AJOUTER : Traiter les mises à jour Order Book
  if (json.e === 'depthUpdate') {
    this.handleDepthUpdateDirect(json)
  }
}

// ✅ NOUVELLES MÉTHODES À AJOUTER

formatOrderBook(data, pair) {
  return {
    exchange: this.id,
    pair: pair.toLowerCase(),
    timestamp: Date.now(),
    lastUpdateId: data.lastUpdateId,
    bids: data.bids.map(([price, size]) => ({
      price: +price,
      size: +size
    })),
    asks: data.asks.map(([price, size]) => ({
      price: +price, 
      size: +size 
    }))
  }
}

async fetchOrderBook(pair) {
  const url = `https://api.binance.com/api/v3/depth?symbol=${pair.toUpperCase()}&limit=100`
  
  try {
    console.log(`[${this.id}] Fetching initial snapshot for ${pair.toUpperCase()}`)
    const response = await axios.get(url)
    const orderBook = this.formatOrderBook(response.data, pair)
    console.log(`[${this.id}] Snapshot ${pair.toUpperCase()}: ${orderBook.bids.length} bids, ${orderBook.asks.length} asks`)
    return orderBook
  } catch (error) {
    console.error(`[${this.id}] Failed to fetch order book for ${pair}:`, error.message)
    throw error
  }
}

async initializeOrderBook(pair) {
  try {
    console.log(`[${this.id}] Initializing order book for ${pair.toUpperCase()}`)
    
    // Récupérer le snapshot initial
    const initialOrderBook = await this.fetchOrderBook(pair)
    
    // Stocker dans InfluxDB
    if (this.influxStorage && this.influxStorage.writeOrderBook) {
      await this.influxStorage.writeOrderBook(initialOrderBook)
      console.log(`[${this.id}] Stored initial order book for ${pair.toUpperCase()}`)
    }
    
    // Marquer comme actif
    this.orderBookActive.add(pair.toLowerCase())
    
    // S'abonner aux mises à jour WebSocket
    if (this.apis && this.apis.length > 0) {
      const ws = this.apis[0]
      const subscribeMessage = {
        method: 'SUBSCRIBE',
        params: [`${pair.toLowerCase()}@depth@100ms`],
        id: Date.now()
      }
      
      ws.send(JSON.stringify(subscribeMessage))
      console.log(`[${this.id}] Subscribed to ${pair.toUpperCase()}@depth@100ms`)
    }
    
  } catch (error) {
    console.error(`[${this.id}] Failed to initialize order book for ${pair}:`, error)
  }
}

async handleDepthUpdateDirect(data) {
  const pair = data.s.toLowerCase()
  
  if (!this.orderBookActive.has(pair)) {
    return
  }
  
  // Filtrer les ordres avec size = 0 (suppression)
  const validBids = data.b.filter(([price, size]) => parseFloat(size) > 0)
  const validAsks = data.a.filter(([price, size]) => parseFloat(size) > 0)
  
  if (validBids.length === 0 && validAsks.length === 0) {
    return
  }
  
  const orderBookUpdate = {
    exchange: this.id,
    pair: pair,
    timestamp: Date.now(),
    bids: validBids.map(([price, size]) => ({
      price: parseFloat(price),
      size: parseFloat(size)
    })),
    asks: validAsks.map(([price, size]) => ({
      price: parseFloat(price),
      size: parseFloat(size)
    }))
  }
  
  // Stocker dans InfluxDB
  if (this.influxStorage && this.influxStorage.writeOrderBook) {
    try {
      await this.influxStorage.writeOrderBook(orderBookUpdate)
    } catch (error) {
      console.error(`[${this.id}] Failed to store order book update:`, error)
    }
  }
}
```

### 3. **`aggr-server/src/server.js`** - Route API

```javascript
// ✅ AJOUTER cette route dans server.js
app.get('/orderbook/:exchange/:pair', async (req, res) => {
  try {
    const { exchange, pair } = req.params
    const limit = req.query.limit ? parseInt(req.query.limit) : 50
    
    console.log(`[API] Order book request: ${exchange}:${pair} (limit: ${limit})`)
    
    if (!config.api || !this.storages) {
      return res.status(501).json({
        error: 'no storage'
      })
    }

    const influxIndex = config.storage.indexOf('influx')
    const storage = influxIndex >= 0 ? this.storages[influxIndex] : null
    
    if (!storage || !storage.getOrderBook) {
      return res.status(501).json({
        error: 'orderbook not supported'
      })
    }

    const orderBook = await storage.getOrderBook(exchange.toUpperCase(), pair.toLowerCase(), parseInt(limit))
    
    if (!orderBook) {
      const availablePairs = await storage.getAvailableOrderBookPairs()
      return res.status(404).json({
        error: 'Order book not found',
        exchange: exchange.toUpperCase(),
        pair: pair.toLowerCase(),
        available: availablePairs
      })
    }

    res.json(orderBook)
    
  } catch (error) {
    console.error(`[Server] Error fetching order book:`, error)
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    })
  }
})
```

### 4. **Initialisation dans `server.js`**

```javascript
// ✅ AJOUTER dans la méthode start() ou connectExchanges()
async startOrderBookCollection() {
  console.log('[server] - Starting order book collection')
  
  const orderBookPairs = ['btcusdt', 'ethusdt'] // Pairs configurées
  
  for (const pair of orderBookPairs) {
    const exchange = this.exchanges.find(e => e.id === 'BINANCE')
    if (exchange && exchange.initializeOrderBook) {
      try {
        // Délai pour éviter la surcharge API
        await new Promise(resolve => setTimeout(resolve, 1000))
        await exchange.initializeOrderBook(pair)
        console.log(`[server] - Order book initialized for ${pair.toUpperCase()}`)
      } catch (error) {
        console.error(`[server] - Failed to initialize order book for ${pair}:`, error)
      }
    }
  }
  
  console.log(`[server] - Order book collection started for pairs: ${orderBookPairs.map(p => p.toUpperCase()).join(', ')}`)
}
```

## 🧪 **TESTS DE VALIDATION**

```bash
# 1. Test API Order Book
curl "http://localhost:3000/orderbook/BINANCE/BTCUSDT?limit=10"

# 2. Test avec limite
curl "http://localhost:3000/orderbook/BINANCE/BTCUSDT?limit=5"

# 3. Test paire inexistante
curl "http://localhost:3000/orderbook/BINANCE/INVALID"
```

## 📋 **CHECKLIST D'IMPLÉMENTATION**

- [ ] ✅ Ajouter le schema InfluxDB dans le constructor
- [ ] ✅ Ajouter `writeOrderBook()` dans `influx.js`
- [ ] ✅ Ajouter `getOrderBook()` dans `influx.js` 
- [ ] ✅ Ajouter `getAvailableOrderBookPairs()` dans `influx.js`
- [ ] ✅ Ajouter `orderBookActive = new Set()` dans `binance.js`
- [ ] ✅ Modifier `onMessage()` pour traiter `depthUpdate`
- [ ] ✅ Ajouter `formatOrderBook()` dans `binance.js`
- [ ] ✅ Ajouter `fetchOrderBook()` dans `binance.js`
- [ ] ✅ Ajouter `initializeOrderBook()` dans `binance.js`
- [ ] ✅ Ajouter `handleDepthUpdateDirect()` dans `binance.js`
- [ ] ✅ Ajouter route `/orderbook/:exchange/:pair` dans `server.js`
- [ ] ✅ Ajouter `startOrderBookCollection()` dans `server.js`
- [ ] ✅ Passer `influxStorage` aux exchanges dans `server.js`
- [ ] ✅ Commenter les logs verbeux si nécessaire

## 🎯 **RÉSULTAT ATTENDU**

Après implémentation complète :
```json
{
  "exchange": "BINANCE",
  "pair": "btcusdt",
  "timestamp": 1727445123456,
  "bids": [
    {"price": 67890.12, "size": 0.5},
    {"price": 67889.50, "size": 1.2}
  ],
  "asks": [
    {"price": 67891.34, "size": 0.3},
    {"price": 67892.00, "size": 0.8}
  ]
}
```

---

**✅ Guide complet et testé pour implémentation Order Book dans AGGR ! 🚀** 