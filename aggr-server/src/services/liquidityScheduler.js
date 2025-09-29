/**
 * Planificateur de calculs de liquidité
 * Extrait du projet AGGR - Calcule ask_sum/bid_sum chaque minute
 */

const LiquidityCalculator = require('./liquidityCalculator')

class LiquidityScheduler {
  constructor(exchanges, influxStorage) {
    this.exchanges = exchanges
    this.influxStorage = influxStorage
    this.calculator = new LiquidityCalculator()
    this.intervalId = null
    this.cleanupIntervalId = null
  }

  /**
   * Démarre le planificateur de calculs de liquidité
   */
  startScheduler() {
    console.log('[LiquidityScheduler] Starting scheduler with 60 depth levels (0.5% to 30% by 0.5%)...')
    
    // Calcul initial immédiat
    this.calculateAndSaveLiquidity()
    
    // Programmer les calculs toutes les minutes (à la seconde 0)
    const now = new Date()
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds()
    
    setTimeout(() => {
      // Premier calcul à la minute exacte
      this.calculateAndSaveLiquidity()
      
      // Puis toutes les minutes
      this.intervalId = setInterval(() => {
        this.calculateAndSaveLiquidity()
      }, 60000) // 60 secondes
      
    }, msUntilNextMinute)
    
    // Nettoyage des anciennes données toutes les heures
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupOldData()
    }, 3600000) // 1 heure
    
    console.log('[LiquidityScheduler] Scheduler started - calculations every minute')
  }

  /**
   * Effectue les calculs de liquidité et sauvegarde dans InfluxDB
   */
  async calculateAndSaveLiquidity() {
    const timestamp = new Date()
    console.log(`[LiquidityScheduler] Starting calculations at ${timestamp.toISOString()}`)
    
    try {
      // Paires à traiter
      const pairs = ['btcusdt', 'ethusdt']
      
      for (const exchange of this.exchanges) {
        if (exchange.id === 'BINANCE') {
          for (const pair of pairs) {
            try {
              // Récupérer l'Order Book depuis InfluxDB (SANS LIMITE)
              const orderBookData = await this.influxStorage.getOrderBook(exchange.id, pair, null)
              
              if (!orderBookData || !orderBookData.bids || !orderBookData.asks) {
                console.warn(`[LiquidityScheduler] No order book data for ${exchange.id}:${pair}`)
                continue
              }
              
              // Calculer le prix moyen
              const midPrice = this.calculator.calculateMidPrice(orderBookData.bids, orderBookData.asks)
              
              if (midPrice <= 0) {
                console.warn(`[LiquidityScheduler] Invalid mid price for ${exchange.id}:${pair}: ${midPrice}`)
                continue
              }
              
              // Calculer toutes les liquidités
              const liquidityData = this.calculator.calculateLiquiditySums(
                orderBookData.bids,
                orderBookData.asks,
                midPrice
              )
              
              // Sauvegarder dans InfluxDB
              await this.influxStorage.writeLiquidityData(exchange.id, pair, timestamp.getTime(), liquidityData)
              
              console.log(`[LiquidityScheduler] Saved ${exchange.id}:${pair} liquidity data (60 depth levels)`)
              
            } catch (error) {
              console.error(`[LiquidityScheduler] Error processing ${exchange.id}:${pair}:`, error.message)
            }
          }
        }
      }
      
      console.log(`[LiquidityScheduler] Calculations completed at ${new Date().toISOString()}`)
      
    } catch (error) {
      console.error('[LiquidityScheduler] Error during calculation:', error)
    }
  }

  /**
   * Nettoie les anciennes données de liquidité (> 24h)
   */
  async cleanupOldData() {
    try {
      console.log('[LiquidityScheduler] Starting cleanup of old liquidity data...')
      
      const threshold = Date.now() - (24 * 60 * 60 * 1000) // 24 heures
      const cleaned = await this.influxStorage.cleanOldLiquidityData(threshold)
      
      if (cleaned > 0) {
        console.log(`[LiquidityScheduler] Cleanup completed: ${cleaned} old records removed`)
      } else {
        console.log('[LiquidityScheduler] Cleanup completed: no old records to remove')
      }
      
    } catch (error) {
      console.error('[LiquidityScheduler] Error during cleanup:', error.message)
    }
  }

  /**
   * Arrête le planificateur
   */
  stop() {
    console.log('[LiquidityScheduler] Stopping scheduler...')
    
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = null
    }
    
    console.log('[LiquidityScheduler] Scheduler stopped')
  }
}

module.exports = LiquidityScheduler 