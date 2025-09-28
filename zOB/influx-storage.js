/**
 * Stockage InfluxDB pour Order Book
 * Extrait de la logique AGGR existante
 */

const Influx = require('influx')

class InfluxStorage {
  constructor(config = {}) {
    this.name = this.constructor.name
    this.format = 'point'
    
    // Configuration par défaut
    this.config = {
      host: config.host || 'localhost',
      port: config.port || 8086,
      database: config.database || 'orderbook_data',
      username: config.username || '',
      password: config.password || '',
      ...config
    }
    
    this.influx = null
    this.connected = false
  }

  /**
   * Connexion à InfluxDB
   */
  async connect() {
    try {
      console.log(`[InfluxDB] Connecting to ${this.config.host}:${this.config.port}/${this.config.database}`)
      
      this.influx = new Influx.InfluxDB({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        username: this.config.username,
        password: this.config.password,
        schema: [
          {
            measurement: 'orderbook',
            fields: {
              price: Influx.FieldType.FLOAT,
              size: Influx.FieldType.FLOAT
            },
            tags: [
              'market',
              'side'
            ]
          }
        ]
      })

      // Créer la base de données si elle n'existe pas
      const databases = await this.influx.getDatabaseNames()
      if (!databases.includes(this.config.database)) {
        console.log(`[InfluxDB] Creating database ${this.config.database}`)
        await this.influx.createDatabase(this.config.database)
      }

      this.connected = true
      console.log(`[InfluxDB] Connected successfully`)
      
    } catch (error) {
      console.error(`[InfluxDB] Connection failed:`, error.message)
      throw error
    }
  }

  /**
   * Écriture des points InfluxDB
   */
  async writePoints(points, options = {}) {
    if (!this.connected || !this.influx) {
      throw new Error('InfluxDB not connected')
    }

    try {
      await this.influx.writePoints(points, options)
    } catch (error) {
      console.error(`[InfluxDB] Write failed:`, error.message)
      throw error
    }
  }

  /**
   * Stocke un Order Book (logique AGGR exacte)
   */
  async writeOrderBook(orderBookData) {
    const points = []
    const market = `${orderBookData.exchange}:${orderBookData.pair}`

    // Convertir les bids en points InfluxDB (comme AGGR)
    orderBookData.bids.forEach((bid, index) => {
      // Timestamp basé sur le prix pour garantir l'upsert (logique AGGR)
      const priceBasedTimestamp = Math.floor(bid.price * 1000)
      
      points.push({
        measurement: 'orderbook',
        tags: { market, side: 'bid' },
        fields: { price: bid.price, size: bid.size },
        timestamp: priceBasedTimestamp
      })
    })

    // Convertir les asks en points InfluxDB (comme AGGR)
    orderBookData.asks.forEach((ask, index) => {
      // Timestamp basé sur le prix pour garantir l'upsert (logique AGGR)
      const priceBasedTimestamp = Math.floor(ask.price * 1000)
      
      points.push({
        measurement: 'orderbook', 
        tags: { market, side: 'ask' },
        fields: { price: ask.price, size: ask.size },
        timestamp: priceBasedTimestamp
      })
    })

    if (points.length > 0) {
      await this.writePoints(points, { precision: 'ms' })
      // console.log(`[InfluxDB] Wrote ${points.length} order book points for ${market}`)
    }
  }

  /**
   * Récupère l'Order Book depuis InfluxDB (logique AGGR exacte)
   */
  async getOrderBook(exchange, pair, limit = 50) {
    if (!this.connected || !this.influx) {
      throw new Error('InfluxDB not connected')
    }

    const market = `${exchange.toUpperCase()}:${pair.toLowerCase()}`
    
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
      console.error(`[InfluxDB] Failed to get order book for ${market}:`, error.message)
      return null
    }
  }

  /**
   * Obtient les paires disponibles
   */
  async getAvailableOrderBookPairs() {
    if (!this.connected || !this.influx) {
      return []
    }

    try {
      const query = `SHOW TAG VALUES FROM orderbook WITH KEY = "market"`
      const results = await this.influx.query(query)
      return results.map(r => r.value)
    } catch (error) {
      console.error(`[InfluxDB] Failed to get available pairs:`, error.message)
      return []
    }
  }

  /**
   * Statistiques du stockage
   */
  async getStats() {
    if (!this.connected || !this.influx) {
      return {
        connected: false,
        totalPairs: 0,
        pairs: []
      }
    }

    try {
      const pairs = await this.getAvailableOrderBookPairs()
      
      // Obtenir la dernière mise à jour pour chaque paire
      const pairStats = []
      for (const pair of pairs.slice(0, 10)) { // Limiter à 10 pour les perfs
        try {
          const query = `
            SELECT LAST(price) as last_price, time as last_update
            FROM orderbook 
            WHERE market = '${pair}'
          `
          const result = await this.influx.query(query)
          if (result.length > 0) {
            pairStats.push({
              pair,
              lastUpdate: result[0].last_update,
              lastPrice: result[0].last_price
            })
          }
        } catch (error) {
          // Ignorer les erreurs pour des paires individuelles
        }
      }

      return {
        connected: true,
        totalPairs: pairs.length,
        pairs: pairStats,
        database: this.config.database,
        host: this.config.host
      }
    } catch (error) {
      console.error(`[InfluxDB] Failed to get stats:`, error.message)
      return {
        connected: false,
        error: error.message
      }
    }
  }

  /**
   * Nettoie les données anciennes
   */
  async cleanup(maxAge = 86400000) { // 24h par défaut
    if (!this.connected || !this.influx) {
      return 0
    }

    try {
      const threshold = Date.now() - maxAge
      const query = `DELETE FROM orderbook WHERE time < ${threshold}ms`
      
      await this.influx.query(query)
      console.log(`[InfluxDB] Cleanup completed for data older than ${maxAge}ms`)
      
      return 1
    } catch (error) {
      console.error(`[InfluxDB] Cleanup failed:`, error.message)
      return 0
    }
  }

  /**
   * Ferme la connexion
   */
  async disconnect() {
    if (this.influx) {
      // InfluxDB client ne nécessite pas de fermeture explicite
      this.connected = false
      console.log(`[InfluxDB] Disconnected`)
    }
  }
}

module.exports = InfluxStorage 