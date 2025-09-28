/**
 * Logique Binance Order Book extraite du projet AGGR
 * Collecte et maintient l'Order Book en temps réel
 */

const WebSocket = require('ws')
const axios = require('axios')

class BinanceOrderBook {
  constructor(influxStorage) {
    this.influxStorage = influxStorage
    this.apis = []
    this.orderBookActive = new Set()
    this.lastSubscriptionId = 0
    this.reconnectTimeouts = new Map()
    this.id = 'BINANCE'
  }

  /**
   * Récupère un snapshot initial de l'Order Book via REST API
   */
  async fetchOrderBook(pair) {
    const symbol = pair.toUpperCase()
    const url = `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`
    
    try {
      console.log(`[${this.id}] Fetching initial snapshot for ${pair}`)
      const response = await axios.get(url, { timeout: 10000 })
      
      const orderBook = {
        exchange: this.id,
        pair: pair.toLowerCase(),
        timestamp: Date.now(),
        lastUpdateId: response.data.lastUpdateId,
        bids: response.data.bids.map(([price, size]) => ({
          price: parseFloat(price),
          size: parseFloat(size)
        })),
        asks: response.data.asks.map(([price, size]) => ({
          price: parseFloat(price),
          size: parseFloat(size)
        }))
      }
      
      console.log(`[${this.id}] Snapshot ${pair}: ${orderBook.bids.length} bids, ${orderBook.asks.length} asks`)
      return orderBook
      
    } catch (error) {
      console.error(`[${this.id}] Failed to fetch snapshot for ${pair}:`, error.message)
      throw error
    }
  }

  /**
   * Initialise la collecte Order Book pour une paire
   */
  async initializeOrderBook(pair) {
    console.log(`[${this.id}] Starting orderbook collection for ${pair}`)
    
    try {
      // 1. Récupérer snapshot initial
      const snapshot = await this.fetchOrderBook(pair)
      
      // 2. Écrire dans InfluxDB
      if (this.influxStorage) {
        await this.influxStorage.writeOrderBook(snapshot)
        console.log(`[${this.id}] Initial order book snapshot written to InfluxDB for ${pair}`)
      }
      
      // 3. Marquer comme actif
      this.orderBookActive.add(pair.toLowerCase())
      
      // 4. S'abonner aux mises à jour WebSocket
      await this.subscribeToDepthUpdates(pair)
      
      console.log(`[${this.id}] Order book collection initialized for ${pair}`)
      
    } catch (error) {
      console.error(`[${this.id}] Failed to initialize order book for ${pair}:`, error.message)
      throw error
    }
  }

  /**
   * S'abonne aux mises à jour de profondeur via WebSocket
   */
  async subscribeToDepthUpdates(pair) {
    const streamName = pair.toLowerCase() + '@depth@100ms'
    
    // Créer une nouvelle connexion WebSocket si nécessaire
    if (this.apis.length === 0) {
      await this.createWebSocketConnection()
    }
    
    // S'abonner sur toutes les connexions actives
    for (const api of this.apis) {
      if (api.readyState === WebSocket.OPEN) {
        const subscribeMsg = {
          method: 'SUBSCRIBE',
          params: [streamName],
          id: ++this.lastSubscriptionId
        }
        
        console.log(`[${this.id}] Subscribing to ${streamName}`)
        api.send(JSON.stringify(subscribeMsg))
        
        // Petit délai entre les souscriptions
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }
  }

  /**
   * Crée une connexion WebSocket vers Binance
   */
  async createWebSocketConnection() {
    // Utiliser l'URL correcte comme dans AGGR
    const wsUrl = 'wss://data-stream.binance.vision:9443/ws'
    
    return new Promise((resolve, reject) => {
      console.log(`[${this.id}] Creating WebSocket connection to ${wsUrl}`)
      
      const ws = new WebSocket(wsUrl)
      
      ws.on('open', () => {
        console.log(`[${this.id}] WebSocket connection opened`)
        this.apis.push(ws)
        resolve(ws)
      })
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString())
          
          // Ignorer les messages de confirmation
          if (message.result === null || message.id) {
            return
          }
          
          // Traiter les mises à jour de profondeur
          if (message.e === 'depthUpdate') {
            this.handleDepthUpdate(message)
          }
          
        } catch (error) {
          console.error(`[${this.id}] Error parsing WebSocket message:`, error.message)
        }
      })
      
      ws.on('error', (error) => {
        console.error(`[${this.id}] WebSocket error:`, error.message)
        reject(error)
      })
      
      ws.on('close', (code, reason) => {
        console.log(`[${this.id}] WebSocket closed: ${code} ${reason}`)
        
        // Retirer de la liste des APIs
        const index = this.apis.indexOf(ws)
        if (index !== -1) {
          this.apis.splice(index, 1)
        }
        
        // Programmer une reconnexion
        this.scheduleReconnection()
      })
    })
  }

  /**
   * Traite les mises à jour de profondeur WebSocket (comme dans AGGR)
   */
  async handleDepthUpdate(data) {
    const pair = data.s.toLowerCase()
    
    if (!this.orderBookActive.has(pair)) {
      return
    }
    
    // Convertir les données WebSocket au format Order Book (comme AGGR)
    const orderBookData = {
      exchange: this.id,
      pair: pair,
      timestamp: Date.now(),
      lastUpdateId: data.u,
      bids: data.b.map(([price, size]) => ({ 
        price: +price, 
        size: +size 
      })),
      asks: data.a.map(([price, size]) => ({ 
        price: +price, 
        size: +size 
      }))
    }
    
    // Filtrer les ordres avec size = 0 (suppression)
    const validBids = orderBookData.bids.filter(bid => bid.size > 0)
    const validAsks = orderBookData.asks.filter(ask => ask.size > 0)
    
    if (validBids.length === 0 && validAsks.length === 0) {
      return
    }
    
    const filteredOrderBook = {
      ...orderBookData,
      bids: validBids,
      asks: validAsks
    }
    
    // Écrire directement dans InfluxDB si on a des changements (comme AGGR)
    if (this.influxStorage) {
      try {
        await this.influxStorage.writeOrderBook(filteredOrderBook)
      } catch (error) {
        console.error(`[${this.id}] Failed to write order book update for ${pair}:`, error.message)
      }
    }
  }



  /**
   * Programme une reconnexion WebSocket
   */
  scheduleReconnection() {
    const delay = 5000 // 5 secondes
    
    console.log(`[${this.id}] Scheduling reconnection in ${delay}ms`)
    
    setTimeout(() => {
      this.createWebSocketConnection().catch(error => {
        console.error(`[${this.id}] Reconnection failed:`, error.message)
        this.scheduleReconnection() // Réessayer
      })
    }, delay)
  }

  /**
   * Démarre la collecte pour les paires par défaut
   */
  async start(pairs = ['BTCUSDT', 'ETHUSDT']) {
    console.log(`[${this.id}] Starting Order Book collection for pairs: ${pairs.join(', ')}`)
    
    for (const pair of pairs) {
      try {
        await this.initializeOrderBook(pair)
        // Petit délai entre les initialisations
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch (error) {
        console.error(`[${this.id}] Failed to start ${pair}:`, error.message)
      }
    }
  }

  /**
   * Arrête la collecte
   */
  stop() {
    console.log(`[${this.id}] Stopping Order Book collection`)
    
    // Fermer toutes les connexions WebSocket
    for (const api of this.apis) {
      if (api.readyState === WebSocket.OPEN) {
        api.close()
      }
    }
    
    this.apis = []
    this.orderBookActive.clear()
  }
}

module.exports = BinanceOrderBook 