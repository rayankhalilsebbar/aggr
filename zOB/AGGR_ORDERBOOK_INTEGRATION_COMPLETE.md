# 🚀 INTÉGRATION COMPLÈTE ORDER BOOK DANS AGGR

## ❌ **CE QUI MANQUE ACTUELLEMENT DANS TON AGGR**

### **1. PROPRIÉTÉ `orderBookActive` dans le Constructor**

**📁 Fichier:** `aggr-server/src/exchanges/binance.js`

**🔍 Dans le constructor, AJOUTER cette ligne:**

```javascript
constructor() {
  super()

  this.id = 'BINANCE'
  this.lastSubscriptionId = 0
  this.maxConnectionsPerApi = 16
  this.subscriptions = {}
  this.orderBookActive = new Set()  // ✅ AJOUTER CETTE LIGNE

  this.endpoints = {
    PRODUCTS: 'https://data-api.binance.vision/api/v3/exchangeInfo'
  }

  this.url = () => `wss://data-stream.binance.vision:9443/ws`
}
```

---

### **2. MODIFICATION de la méthode `onMessage`**

**📁 Fichier:** `aggr-server/src/exchanges/binance.js`

**🔍 REMPLACER la méthode onMessage par:**

```javascript
onMessage(event, api) {
  const json = JSON.parse(event.data)

  // Handle trades
  if (json.E && json.e === 'trade') {
    return this.emitTrades(api.id, [
      this.formatTrade(json, json.s.toLowerCase())
    ])
  }

  // ✅ AJOUTER CES LIGNES - Handle order book updates  
  if (json.e === 'depthUpdate') {
    this.handleDepthUpdateDirect(json)
  }
}
```

---

### **3. AJOUTER la méthode `formatOrderBook`**

**📁 Fichier:** `aggr-server/src/exchanges/binance.js`

**🔍 AJOUTER cette méthode (après formatTrade):**

```javascript
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
```

---

### **4. AJOUTER la méthode `fetchOrderBook`**

**📁 Fichier:** `aggr-server/src/exchanges/binance.js`

**🔍 AJOUTER cette méthode (après formatOrderBook):**

```javascript
/**
 * Fetch order book snapshot from Binance API
 * @param {string} pair Trading pair
 */
async fetchOrderBook(pair) {
  const url = `https://api.binance.com/api/v3/depth?symbol=${pair.toUpperCase()}&limit=100`
  
  try {
    const response = await axios.get(url)
    return this.formatOrderBook(response.data, pair)
  } catch (error) {
    console.error(`[${this.id}] Failed to fetch order book for ${pair}:`, error.message)
    throw error
  }
}
```

---

### **5. AJOUTER la méthode `initializeOrderBook`**

**📁 Fichier:** `aggr-server/src/exchanges/binance.js`

**🔍 AJOUTER cette méthode (après fetchOrderBook):**

```javascript
/**
 * Initialize order book collection for a trading pair
 * @param {string} pair Trading pair (lowercase)
 */
async initializeOrderBook(pair) {
  console.log(`[${this.id}] Starting orderbook collection for ${pair}`)
  
  try {
    // 1. Fetch initial snapshot
    const snapshot = await this.fetchOrderBook(pair)
    
    // 2. Write to InfluxDB
    if (this.influxStorage) {
      await this.influxStorage.writeOrderBook(snapshot)
      console.log(`[${this.id}] Initial order book snapshot written for ${pair}`)
    }
    
    // 3. Mark as active for WebSocket
    this.orderBookActive.add(pair)
    
    // 4. Subscribe to depth updates on all APIs
    for (const api of this.apis) {
      if (api.readyState === 1) { // WebSocket.OPEN
        const params = [pair + '@depth@100ms']
        api.send(
          JSON.stringify({
            method: 'SUBSCRIBE',
            params,
            id: ++this.lastSubscriptionId
          })
        )
        await sleep(250)
      }
    }
    
    console.log(`[${this.id}] Order book collection initialized for ${pair}`)
    
  } catch (error) {
    console.error(`[${this.id}] Failed to initialize order book for ${pair}:`, error.message)
    throw error
  }
}
```

---

### **6. AJOUTER la méthode `handleDepthUpdateDirect`**

**📁 Fichier:** `aggr-server/src/exchanges/binance.js`

**🔍 AJOUTER cette méthode (après initializeOrderBook):**

```javascript
/**
 * Handle WebSocket depth updates and write directly to InfluxDB
 * @param {Object} data Depth update from WebSocket
 */
async handleDepthUpdateDirect(data) {
  const pair = data.s.toLowerCase()
  
  if (!this.orderBookActive.has(pair)) {
    return
  }
  
  // Convert WebSocket data to order book format
  const orderBookData = {
    exchange: this.id,
    pair: pair,
    timestamp: Date.now(),
    lastUpdateId: data.u,
    bids: data.b.map(([price, size]) => ({ 
      price: +price, 
      size: +size 
    })).filter(bid => bid.size > 0), // Only keep non-zero sizes
    asks: data.a.map(([price, size]) => ({ 
      price: +price, 
      size: +size 
    })).filter(ask => ask.size > 0) // Only keep non-zero sizes
  }
  
  // Write directly to InfluxDB if we have updates
  if (this.influxStorage && (orderBookData.bids.length > 0 || orderBookData.asks.length > 0)) {
    try {
      await this.influxStorage.writeOrderBook(orderBookData)
    } catch (error) {
      console.error(`[${this.id}] Failed to write order book update for ${pair}:`, error.message)
    }
  }
}
```

---

## 🔧 **MODIFICATIONS SERVEUR**

### **7. MODIFICATION dans `server.js`**

**📁 Fichier:** `aggr-server/src/server.js`

**🔍 Dans la méthode `connectExchanges()`, AJOUTER après la ligne `this.scheduleNextBackup()`:**

```javascript
connectExchanges() {
  // ... code existant ...
  
  this.scheduleNextBackup()
  
  // ✅ AJOUTER CETTE LIGNE
  this.startOrderBookCollection()
}

// ✅ AJOUTER CETTE MÉTHODE COMPLÈTE
/**
 * Auto-start order book collection for configured pairs
 */
async startOrderBookCollection() {
  // Simple configuration - add pairs you want order book for
  const orderBookPairs = ['btcusdt', 'ethusdt', 'adausdt']
  
  console.log(`[server] Starting order book collection for ${orderBookPairs.length} pairs`)
  
  for (const pair of orderBookPairs) {
    const binance = this.exchanges.find(e => e.id === 'BINANCE')
    
    if (binance && typeof binance.initializeOrderBook === 'function') {
      try {
        // Start with a small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000))
        await binance.initializeOrderBook(pair)
        console.log(`[server] Order book collection started for ${pair}`)
      } catch (error) {
        console.error(`[server] Failed to start order book for ${pair}:`, error.message)
      }
    }
  }
  
  console.log(`[server] Order book auto-start completed`)
}
```

---

### **8. VÉRIFICATION de l'import `sleep`**

**📁 Fichier:** `aggr-server/src/exchanges/binance.js`

**🔍 Vérifier que cette ligne existe en haut du fichier:**

```javascript
const { sleep, getHms } = require('../helper')  // ✅ VÉRIFIER que sleep est importé
```

---

## ✅ **RÉSUMÉ DES MODIFICATIONS**

### **Dans `binance.js`:**
1. ✅ Ajouter `this.orderBookActive = new Set()` dans constructor
2. ✅ Modifier `onMessage()` pour gérer `depthUpdate`
3. ✅ Ajouter `formatOrderBook()`
4. ✅ Ajouter `fetchOrderBook()`
5. ✅ Ajouter `initializeOrderBook()`
6. ✅ Ajouter `handleDepthUpdateDirect()`

### **Dans `server.js`:**
7. ✅ Ajouter `this.startOrderBookCollection()` dans `connectExchanges()`
8. ✅ Ajouter la méthode `startOrderBookCollection()`

---

## 🧪 **COMMENT TESTER**

**Une fois toutes les modifications appliquées, tu devrais voir ces logs:**

```
[server] Starting order book collection for 3 pairs
[BINANCE] Starting orderbook collection for btcusdt
[BINANCE] Initial order book snapshot written for btcusdt
[BINANCE] Order book collection initialized for btcusdt
[server] Order book collection started for btcusdt
[BINANCE] Starting orderbook collection for ethusdt
[BINANCE] Initial order book snapshot written for ethusdt
[BINANCE] Order book collection initialized for ethusdt
[server] Order book collection started for ethusdt
[BINANCE] Starting orderbook collection for adausdt
[BINANCE] Initial order book snapshot written for adausdt
[BINANCE] Order book collection initialized for adausdt
[server] Order book collection started for adausdt
[server] Order book auto-start completed

# Et ensuite, en continu:
[InfluxDB] Wrote order book points for BINANCE:BTCUSDT
[InfluxDB] Wrote order book points for BINANCE:ETHUSDT
[InfluxDB] Wrote order book points for BINANCE:ADAUSDT
```

---

## 🚨 **POINTS CRITIQUES**

1. **`this.orderBookActive = new Set()`** → Sans ça, `handleDepthUpdateDirect` ne traite aucun message
2. **`if (json.e === 'depthUpdate')`** → Sans ça, les messages WebSocket sont ignorés
3. **`handleDepthUpdateDirect()`** → Sans ça, pas de sauvegarde des mises à jour
4. **`startOrderBookCollection()`** → Sans ça, pas d'initialisation automatique

**Toutes ces méthodes sont ESSENTIELLES et manquent dans ton implémentation actuelle !** 

Une fois appliquées, ton Order Book devrait se mettre à jour en temps réel dans InfluxDB. 🎯 