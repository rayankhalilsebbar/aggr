/**
 * Calculateur de liquidité Order Book
 * Extrait du projet AGGR - Logique ask_sum/bid_sum
 */

class LiquidityCalculator {
  constructor() {
    // Générer les pourcentages de profondeur de 0.5% à 30% par pas de 0.5%
    this.depthPercentages = []
    for (let i = 0.5; i <= 30; i += 0.5) {
      this.depthPercentages.push(i)
    }
    console.log(`[LiquidityCalculator] Initialized with ${this.depthPercentages.length} depth levels: ${this.depthPercentages[0]}% to ${this.depthPercentages[this.depthPercentages.length - 1]}%`)
  }

  /**
   * Calcule tous les ask_sum et bid_sum pour tous les pourcentages
   * @param {Array} bids - Tableau des bids triés par prix décroissant
   * @param {Array} asks - Tableau des asks triés par prix croissant
   * @param {number} midPrice - Prix moyen (bestBid + bestAsk) / 2
   * @returns {Object} Objet avec tous les ask_sum_X et bid_sum_X
   */
  calculateLiquiditySums(bids, asks, midPrice) {
    const result = {
      // Totaux
      bid_sum_total: this.calculateTotalSum(bids),
      ask_sum_total: this.calculateTotalSum(asks)
    }

    // Calculer pour chaque pourcentage de profondeur
    for (const percent of this.depthPercentages) {
      const bidSum = this.calculateRangeSum(bids, midPrice, percent, 'bid')
      const askSum = this.calculateRangeSum(asks, midPrice, percent, 'ask')
      
      result[`bid_sum_${percent}pct`] = bidSum
      result[`ask_sum_${percent}pct`] = askSum
    }

    return result
  }

  /**
   * ✅ LOGIQUE FONCTIONNELLE - Calcule la somme des liquidités (comme code actuel)
   * @param {Array} orders - Bids ou asks
   * @param {number} midPrice - Prix moyen
   * @param {number} percent - Pourcentage de profondeur
   * @param {string} side - 'bid' ou 'ask'
   * @returns {number} Somme des liquidités
   */
  calculateRangeSum(orders, midPrice, percent, side) {
    if (!orders || orders.length === 0) return 0

    let total = 0

    if (side === 'bid') {
      // Pour les bids: midPrice * (1 - pct/100) → prix plancher
      const floor = midPrice * (1 - percent / 100)
      
      // DEBUG: Log pour 0.5% seulement
      if (percent === 0.5) {
        console.log(`[DEBUG] BID ${percent}% - midPrice: ${midPrice}, floor: ${floor}, orders: ${orders.length}`)
        console.log(`[DEBUG] First 3 bids:`, orders.slice(0, 3).map(o => `${o.price}:${o.size}`))
      }
      
      for (const order of orders) {
        if (order && typeof order.price === 'number' && typeof order.size === 'number') {
          if (order.price < floor) {
            if (percent === 0.5) console.log(`[DEBUG] BID Break at price ${order.price} < floor ${floor}`)
            break  // Arrêter si prix trop bas (bids triés décroissant)
          }
          total += order.size
        }
      }
    } else {
      // Pour les asks: midPrice * (1 + pct/100) → prix plafond
      const cap = midPrice * (1 + percent / 100)
      
      // DEBUG: Log pour 0.5% seulement
      if (percent === 0.5) {
        console.log(`[DEBUG] ASK ${percent}% - midPrice: ${midPrice}, cap: ${cap}, orders: ${orders.length}`)
        console.log(`[DEBUG] First 3 asks:`, orders.slice(0, 3).map(o => `${o.price}:${o.size}`))
      }
      
      for (const order of orders) {
        if (order && typeof order.price === 'number' && typeof order.size === 'number') {
          if (order.price > cap) {
            if (percent === 0.5) console.log(`[DEBUG] ASK Break at price ${order.price} > cap ${cap}`)
            break   // Arrêter si prix trop haut (asks triés croissant)
          }
          total += order.size
        }
      }
    }

    if (percent === 0.5) console.log(`[DEBUG] ${side.toUpperCase()} ${percent}% total: ${total}`)
    return total
  }

  /**
   * Calcule la somme totale des liquidités
   * @param {Array} orders - Bids ou asks
   * @returns {number} Somme totale
   */
  calculateTotalSum(orders) {
    if (!orders || orders.length === 0) return 0
    
    let sum = 0
    for (const order of orders) {
      if (order && typeof order.size === 'number') {
        sum += order.size
      }
    }
    return sum
  }

  /**
   * ✅ NOUVELLE MÉTHODE - Obtenir le meilleur bid (prix le plus élevé)
   * @param {Array} bids - Bids triés par prix décroissant
   * @returns {number} Meilleur prix bid
   */
  getBestBid(bids) {
    if (!bids || bids.length === 0) return 0
    
    for (const bid of bids) {
      if (bid && typeof bid.price === 'number' && bid.price > 0) {
        return bid.price // Premier élément = meilleur prix (trié décroissant)
      }
    }
    return 0
  }

  /**
   * ✅ NOUVELLE MÉTHODE - Obtenir le meilleur ask (prix le plus bas)
   * @param {Array} asks - Asks triés par prix croissant
   * @returns {number} Meilleur prix ask
   */
  getBestAsk(asks) {
    if (!asks || asks.length === 0) return Infinity
    
    for (const ask of asks) {
      if (ask && typeof ask.price === 'number' && ask.price > 0) {
        return ask.price // Premier élément = meilleur prix (trié croissant)
      }
    }
    return Infinity
  }

  /**
   * Calcule le prix moyen (mid price) entre le meilleur bid et ask
   * @param {Array} bids - Bids triés par prix décroissant
   * @param {Array} asks - Asks triés par prix croissant
   * @returns {number} Prix moyen
   */
  calculateMidPrice(bids, asks) {
    if (!bids || !asks || bids.length === 0 || asks.length === 0) return 0
    
    const bestBid = this.getBestBid(bids)
    const bestAsk = this.getBestAsk(asks)
    
    if (bestBid > 0 && bestAsk !== Infinity) {
      return (bestBid + bestAsk) / 2
    }
    
    return 0
  }

  /**
   * Obtient la liste des pourcentages supportés
   * @returns {Array} Liste des pourcentages
   */
  getSupportedPercentages() {
    return [...this.depthPercentages]
  }
}

module.exports = LiquidityCalculator 