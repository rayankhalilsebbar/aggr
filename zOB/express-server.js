/**
 * Serveur Express simple pour Order Book
 * Extrait de la logique AGGR existante
 */

const express = require('express')
const cors = require('cors')

class OrderBookServer {
  constructor(influxStorage) {
    this.influxStorage = influxStorage
    this.app = express()
    this.server = null
    this.setupMiddleware()
    this.setupRoutes()
  }

  /**
   * Configure les middlewares
   */
  setupMiddleware() {
    this.app.use(cors())
    this.app.use(express.json())
    
    // Logging middleware
    this.app.use((req, res, next) => {
      const timestamp = new Date().toISOString()
      console.log(`[${timestamp}] ${req.method} ${req.path}`)
      next()
    })
  }

  /**
   * Configure les routes
   */
  setupRoutes() {
    // Route principale - Order Book
    this.app.get('/orderbook/:exchange/:pair', async (req, res) => {
      const { exchange, pair } = req.params
      const { limit = 50 } = req.query
      
      try {
        const orderBook = await this.influxStorage.getOrderBook(exchange.toUpperCase(), pair.toLowerCase(), parseInt(limit))
        
        if (!orderBook) {
          const availablePairs = await this.influxStorage.getAvailableOrderBookPairs()
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

    // Route de statut
    this.app.get('/status', async (req, res) => {
      try {
        const stats = await this.influxStorage.getStats()
        
        res.json({
          status: 'running',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          storage: stats
        })
        
      } catch (error) {
        console.error(`[Server] Error getting status:`, error)
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        })
      }
    })

    // Route de santé
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString()
      })
    })

    // Route pour lister les paires disponibles
    this.app.get('/pairs', async (req, res) => {
      try {
        const pairs = await this.influxStorage.getAvailableOrderBookPairs()
        
        res.json({
          pairs,
          count: pairs.length,
          timestamp: new Date().toISOString()
        })
        
      } catch (error) {
        console.error(`[Server] Error getting pairs:`, error)
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        })
      }
    })

    // Route 404 pour toutes les autres requêtes
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl,
        availableEndpoints: [
          'GET /orderbook/:exchange/:pair',
          'GET /status',
          'GET /health',
          'GET /pairs'
        ]
      })
    })

    // Gestionnaire d'erreurs global
    this.app.use((error, req, res, next) => {
      console.error(`[Server] Unhandled error:`, error)
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      })
    })
  }

  /**
   * Démarre le serveur
   */
  start(port = 3000) {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, (error) => {
        if (error) {
          console.error(`[Server] Failed to start on port ${port}:`, error)
          reject(error)
        } else {
          console.log(`[Server] Order Book API running on http://localhost:${port}`)
          console.log(`[Server] Available endpoints:`)
          console.log(`  GET /orderbook/:exchange/:pair - Get order book`)
          console.log(`  GET /status - Server status`)
          console.log(`  GET /health - Health check`)
          console.log(`  GET /pairs - Available pairs`)
          resolve(this.server)
        }
      })
    })
  }

  /**
   * Arrête le serveur
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[Server] Server stopped')
          resolve()
        })
      } else {
        resolve()
      }
    })
  }
}

module.exports = OrderBookServer 