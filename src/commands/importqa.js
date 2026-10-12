import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.POSTGRES_URL });

const GUILD_ID_OLD = '1126304434901749761';
const GUILD_CONFIG = {"prefix": "!", "logging": {"ignore": {"users": [], "channels": []}, "enabled": true, "channels": {"audit": "1129400070664634428", "reports": null, "applications": null}, "enabledEvents": {}}, "modRole": null, "autoRole": null, "adminRole": null, "dmOnClose": true, "verification": {"enabled": false, "buttonText": "Verify"}, "premiumRoleId": null, "welcomeChannel": null, "welcomeMessage": "Welcome {user} to {server}! We now have {memberCount} members!", "enabledCommands": {}, "disabledCommands": {}, "birthdayChannelId": null, "disabledCategories": {"economy": true, "birthday": true, "serverstats": true}, "setupWizardCompleted": true};

const ROWS = [
 {
  "id": 2,
  "q": "What is a common mistake in Context reading",
  "a": "A common mistake is ignoring the broader market structure and focusing only on recent price action.",
  "t": "Rookie"
 },
 {
  "id": 3,
  "q": "What is a common mistake in Location reading",
  "a": "Failing to understand where price is relative to previous support/resistance levels and value areas.",
  "t": "Rookie"
 },
 {
  "id": 4,
  "q": "What is a common mistake in Confirmation reading",
  "a": "Entering too early without waiting for multiple confirmations from different tools like price action and order flow.",
  "t": "Rookie"
 },
 {
  "id": 5,
  "q": "When do I enter on the models",
  "a": "Enter when price reaches key levels confirmed by your chosen models and shows reversal signals.",
  "t": "Rookie"
 },
 {
  "id": 7,
  "q": "How to read TPO",
  "a": "TPO (Time Price Opportunity) shows how much time price spent at each level. Higher TPO = more trading activity.",
  "t": "Rookie"
 },
 {
  "id": 6,
  "q": "How to read CVD",
  "a": "CVD (Cumulative Volume Delta) shows buying vs selling pressure. Rising CVD = buyer control, falling = seller control.",
  "t": "Rookie"
 },
 {
  "id": 8,
  "q": "Where did my trade go wrong",
  "a": "Review your entry/exit logic, check if price action matched your setup, and identify where you ignored your rules.",
  "t": "Rookie"
 },
 {
  "id": 9,
  "q": "Order Flow",
  "a": "Order flow is the real-time buying and selling activity in the market, showing where smart money is accumulating or distributing.",
  "t": "Rookie"
 },
 {
  "id": 10,
  "q": "What is absorption",
  "a": "Absorption occurs when large bids/asks are filled without significant price movement, indicating institutional accumulation or distribution.",
  "t": "Rookie"
 },
 {
  "id": 11,
  "q": "What is CVD and how do I use it",
  "a": "CVD tracks cumulative buying vs selling volume. Use it to confirm trends and identify divergences from price action.",
  "t": "Rookie"
 },
 {
  "id": 12,
  "q": "What does positive/negative delta mean",
  "a": "Positive delta = more buying volume, negative delta = more selling volume. Use to confirm trend direction.",
  "t": "Rookie"
 },
 {
  "id": 13,
  "q": "What is an imbalance",
  "a": "An imbalance is where large buy or sell orders exist without offsetting orders, creating potential for rapid price movement.",
  "t": "Rookie"
 },
 {
  "id": 14,
  "q": "How to spot a stop hunt",
  "a": "Look for price reversals after breakouts with volume spikes in the opposite direction, trapping those who followed the breakout.",
  "t": "Rookie"
 },
 {
  "id": 15,
  "q": "What is exhaustion",
  "a": "Exhaustion occurs when buying or selling pressure weakens despite continued price movement, often signaling a reversal.",
  "t": "Rookie"
 },
 {
  "id": 16,
  "q": "What is the difference between aggressive buyers and sellers",
  "a": "Aggressive buyers lift offers; aggressive sellers hit bids. Aggressive activity shows conviction and can indicate trend continuation.",
  "t": "Rookie"
 },
 {
  "id": 17,
  "q": "How do I use footprint charts",
  "a": "Footprint charts show buy/sell volume at each price level per candle. Use to identify which levels had most trading activity.",
  "t": "Rookie"
 },
 {
  "id": 18,
  "q": "What confirms a reversal using order flow",
  "a": "Divergence between price and CVD, absorption at key levels, and sudden shift from aggressive buyers to aggressive sellers confirm reversals.",
  "t": "Rookie"
 },
 {
  "id": 19,
  "q": "What is the difference between absorption and exhaustion",
  "a": "Absorption = large orders soaking up volume silently; exhaustion = buying/selling pressure weakening despite price movement.",
  "t": "Rookie"
 },
 {
  "id": 20,
  "q": "What is gamma exposure (GEX)",
  "a": "GEX measures option dealers'' hedging pressure. Positive GEX supports reversals; negative GEX supports continuations.",
  "t": "Rookie"
 },
 {
  "id": 21,
  "q": "What are call walls and put walls",
  "a": "Call walls = large sell orders at strike prices (bearish); put walls = large buy orders at strike prices (bullish).",
  "t": "Rookie"
 },
 {
  "id": 22,
  "q": "What is HVL",
  "a": "HVL (High Volume Level) is a price level with significantly more trading activity, often acting as support/resistance.",
  "t": "Rookie"
 },
 {
  "id": 23,
  "q": "What is 0DTE flow",
  "a": "0DTE (Zero Days To Expiration) options flow shows last-day activity, often causing sharp price moves to strike prices.",
  "t": "Rookie"
 },
 {
  "id": 24,
  "q": "How do options dealers hedge",
  "a": "Dealers hedge by buying/selling underlying assets opposite their option exposure to remain delta neutral.",
  "t": "Rookie"
 },
 {
  "id": 25,
  "q": "What is positive vs negative gamma",
  "a": "Positive gamma = acceleration into moves (supportive); negative gamma = deceleration (dealers hedging against moves).",
  "t": "Rookie"
 },
 {
  "id": 26,
  "q": "Why does price pin to certain strikes",
  "a": "Price pins to strikes where large call/put walls exist because dealers manage hedging and max pain dynamics.",
  "t": "Rookie"
 },
 {
  "id": 27,
  "q": "How do gamma levels act as support/resistance",
  "a": "High gamma creates sticky support/resistance as dealers aggressively hedge large option positions at those levels.",
  "t": "Rookie"
 },
 {
  "id": 28,
  "q": "What makes a gamma level strong",
  "a": "Large open interest, high IV, and significant dealer exposure make gamma levels strong support/resistance.",
  "t": "Rookie"
 },
 {
  "id": 29,
  "q": "How do I combine options flow with price action",
  "a": "Use options flow to identify where dealers are hedged; combine with price action support/resistance to confirm trade setups.",
  "t": "Rookie"
 },
 {
  "id": 30,
  "q": "What is value",
  "a": "Value is the fair price range where the market spent most time; represented by VAL (Value Area Low) to VAH (Value Area High).",
  "t": "Rookie"
 },
 {
  "id": 31,
  "q": "What are VAH, VAL and POC",
  "a": "VAH (Value Area High) and VAL (Value Area Low) bracket the value range; POC (Point of Control) is the most traded price.",
  "t": "Rookie"
 },
 {
  "id": 32,
  "q": "What is price acceptance vs rejection",
  "a": "Acceptance = price stays and trades at a level; rejection = price quickly moves away from a level.",
  "t": "Rookie"
 },
 {
  "id": 33,
  "q": "What is balance vs imbalance",
  "a": "Balance = two-sided market with buyers and sellers; imbalance = one-sided, creating directional moves.",
  "t": "Rookie"
 },
 {
  "id": 34,
  "q": "What is an initiative move",
  "a": "An initiative move is when one side (buyers or sellers) aggressively pushes price in a new direction against previous balance.",
  "t": "Rookie"
 },
 {
  "id": 35,
  "q": "What is responsive buying/selling",
  "a": "Responsive activity = reactions to price moves; occurs when the market is balanced and neither side dominates.",
  "t": "Rookie"
 },
 {
  "id": 36,
  "q": "What is excess",
  "a": "Excess is price movement beyond the value range, often leading to pullbacks into value as market rebalances.",
  "t": "Rookie"
 },
 {
  "id": 37,
  "q": "What is a failed auction",
  "a": "A failed auction occurs when price tries to extend higher or lower but fails, reversing back into the value area.",
  "t": "Rookie"
 },
 {
  "id": 38,
  "q": "What is a poor high or poor low",
  "a": "A poor high/low is a level with low volume and quick rejection, indicating weak conviction and likely reversal.",
  "t": "Rookie"
 },
 {
  "id": 39,
  "q": "What is a single print",
  "a": "A single print is a price level traded only once in a session, often acting as support/resistance until tested again.",
  "t": "Rookie"
 },
 {
  "id": 40,
  "q": "How do I identify rotational vs trending markets",
  "a": "Rotational = price bouncing within value area; trending = price breaking value and establishing new value areas.",
  "t": "Rookie"
 },
 {
  "id": 41,
  "q": "What does the market need to do to continue higher/lower",
  "a": "Market must break previous highs/lows on volume, establish new value, and show no rejection at new price levels.",
  "t": "Rookie"
 },
 {
  "id": 42,
  "q": "What is negative Gamma",
  "a": "Volatile movements both to the up & downside.",
  "t": "Rookie"
 },
 {
  "id": 43,
  "q": "What is Positive Gamma",
  "a": "Choppy & hedge based movements. ",
  "t": "Rookie"
 },
 {
  "id": 44,
  "q": "When is it positive regime. ",
  "a": "Above HVL = Positive regime/slow grinds and choppy",
  "t": "Rookie"
 },
 {
  "id": 45,
  "q": "When is it Negative Regime",
  "a": "Below HVL = Negative regime, amplified moves, every aggressive and large candles",
  "t": "Rookie"
 },
 {
  "id": 46,
  "q": "What's the limit?",
  "a": "There is no limit to the larp.",
  "t": "Rookie"
 },
 {
  "id": 47,
  "q": "Who is the TOFC Management",
  "a": "1, Chromey 2, Brandon 3, Benny",
  "t": "Rookie"
 },
 {
  "id": 48,
  "q": "Whats CVD",
  "a": "CVD tracks cumulative buying vs selling volume. Use it to confirm trends and identify divergences from price action.",
  "t": "Rookie"
 },
 {
  "id": 49,
  "q": "What is a stacked imbalance?",
  "a": "Multiple consecutive imbalances at the same price levels, showing sustained aggressive buying or selling and often signaling strong directional intent.",
  "t": "Rookie"
 },
 {
  "id": 50,
  "q": "What is delta divergence?",
  "a": "When price makes a new high/low but CVD doesn't confirm it, signaling weakening momentum and a possible reversal.",
  "t": "Rookie"
 },
 {
  "id": 51,
  "q": "What is spoofing in order flow?",
  "a": "Placing large fake orders to create false impressions of support/resistance, then pulling them before execution to manipulate price.",
  "t": "Rookie"
 },
 {
  "id": 52,
  "q": "What is iceberg order detection?",
  "a": "Identifying large hidden orders that refill after being partially filled, visible as repeated absorption at the same price level.",
  "t": "Rookie"
 },
 {
  "id": 53,
  "q": "What's the difference between passive and aggressive orders?",
  "a": "assive orders sit in the book waiting to be filled (limit orders); aggressive orders immediately take liquidity (market orders hitting bids/offers).",
  "t": "Rookie"
 },
 {
  "id": 54,
  "q": "What is a liquidity void?",
  "a": "A price range with very little historical trading activity, where price tends to move through quickly due to lack of resistance.",
  "t": "Rookie"
 },
 {
  "id": 55,
  "q": "What is delta flip?",
  "a": "A sudden shift from positive to negative delta (or vice versa) within a short timeframe, signaling a change in control between buyers and sellers.",
  "t": "Rookie"
 },
 {
  "id": 56,
  "q": "What is a gamma flip level?",
  "a": "The price level where dealer gamma exposure shifts from positive to negative, changing market behavior from stable to volatile.",
  "t": "Rookie"
 },
 {
  "id": 57,
  "q": "What is dealer positioning and why does it matter?",
  "a": "Dealers hedge their net option exposure; understanding whether they're net long or short gamma helps predict if price action will be dampened or amplified.",
  "t": "Rookie"
 },
 {
  "id": 58,
  "q": "What is a volatility crush?",
  "a": "A sharp drop in implied volatility (often post-earnings or post-event), which can cause option prices to fall even if the underlying moves favorably.",
  "t": "Rookie"
 },
 {
  "id": 59,
  "q": "How do 0DTE options amplify intraday volatility?",
  "a": "Because they have no time value cushion, dealers must hedge aggressively and quickly, causing sharper, faster price reactions near key strikes.",
  "t": "Rookie"
 },
 {
  "id": 60,
  "q": "What is Auction Market Theory (AMT)?",
  "a": "A framework viewing markets as a continuous two-way auction where price moves to facilitate trade, seeking areas of agreement (value) and testing areas of disagreement (extremes) until a fair price is found.",
  "t": "Rookie"
 },
 {
  "id": 61,
  "q": "What is the purpose of an auction in markets?",
  "a": "To facilitate trade by moving price up or down until it finds a level that attracts enough opposite-side interest to balance buyers and sellers.",
  "t": "Rookie"
 },
 {
  "id": 62,
  "q": "What is the opening range and why does it matter?",
  "a": "The initial price range formed early in the session; used to gauge whether the day will be balanced (rotational) or trending (directional).",
  "t": "Rookie"
 },
 {
  "id": 63,
  "q": "What is a b-shaped vs p-shaped profile?",
  "a": "A b-shape (value built at the bottom, thin top) suggests short covering/failed rally; a p-shape (value built at the top, thin bottom) suggests long liquidation/failed breakdown.",
  "t": "Rookie"
 },
 {
  "id": 64,
  "q": "What is 0DTE?",
  "a": "Options that expire the same day they're traded (\"zero days to expiration\"), carrying no overnight time value and causing sharp, fast dealer hedging flows near key strikes.",
  "t": "Rookie"
 },
 {
  "id": 65,
  "q": "What is put support?",
  "a": "A price level where heavy put open interest exists; as price approaches it, dealers who sold those puts buy the underlying to hedge, creating buying pressure that can support price.",
  "t": "Rookie"
 },
 {
  "id": 66,
  "q": "What is Call Resistance",
  "a": "A price level with heavy call open interest; as price approaches it, dealers who sold those calls sell the underlying to hedge, creating selling pressure that can cap price.",
  "t": "Rookie"
 },
 {
  "id": 67,
  "q": "What is the gamma wall?",
  "a": "The strike with the largest concentration of dealer gamma exposure; price tends to gravitate toward or get \"pinned\" near this level, especially close to expiration.",
  "t": "Rookie"
 },
 {
  "id": 68,
  "q": "What is net gamma exposure (net GEX)?",
  "a": "The aggregate gamma dealers hold across all strikes; positive net GEX suppresses volatility (dealers buy dips/sell rips), negative net GEX amplifies it (dealers sell dips/buy rips).",
  "t": "Rookie"
 },
 {
  "id": 69,
  "q": "What happens when price breaks below put support?",
  "a": "Dealer hedging flips from supportive to accelerating as puts go further in-the-money, dealers sell more of the underlying, adding downside pressure instead of cushioning it.",
  "t": "Rookie"
 },
 {
  "id": 70,
  "q": "What happens when price breaks above call resistance?",
  "a": "Similarly, dealers must buy more of the underlying to stay hedged as calls go in-the-money, which can fuel a further breakout instead of capping the move.",
  "t": "Rookie"
 },
 {
  "id": 71,
  "q": "How do put support and call resistance change near expiration?",
  "a": "Their influence intensifies as gamma increases closer to expiry, making price action more \"sticky\" around these strikes on 0DTE and weekly expiration days.",
  "t": "Rookie"
 },
 {
  "id": 72,
  "q": "What is a gamma squeeze?",
  "a": "A rapid price acceleration caused by dealers being forced to buy more of the underlying as calls move deeper in-the-money, creating a feedback loop of hedging-driven buying.",
  "t": "Rookie"
 },
 {
  "id": 73,
  "q": "What is an IFVG",
  "a": "We don't do IFVG's here bro... This is orderflow & and optionflow",
  "t": "Rookie"
 },
 {
  "id": 74,
  "q": "Test",
  "a": "Test success, what else do you want me to say man. Baked beans?",
  "t": "Rookie"
 },
 {
  "id": 75,
  "q": "What are the volume profile vp settings",
  "a": "Please refer to the community https://discord.com/channels/1126304434901749761/1543075505807564841 for settings. ",
  "t": "Rookie"
 },
 {
  "id": 76,
  "q": "Where can I see GEX Levels",
  "a": "https://discord.com/channels/1126304434901749761/1505682147485155478",
  "t": "Rookie"
 },
 {
  "id": 77,
  "q": "Where can I buy the mentorship",
  "a": "You can purchase the mentorship here: https://whop.com/the-orderflow-club/",
  "t": "Rookie"
 },
 {
  "id": 78,
  "q": "Where are my roles",
  "a": "If your rules are missing, please try re-claim them via the whop portal. ",
  "t": "Rookie"
 },
 {
  "id": 79,
  "q": "PREMIUM TEST",
  "a": "This is a test for PREMIUM",
  "t": "Premium"
 },
 {
  "id": 80,
  "q": "What is The model 1",
  "a": "Trading strat",
  "t": "Premium"
 },
 {
  "id": 81,
  "q": "What is the M1 ",
  "a": "Trading strat",
  "t": "Premium"
 },
 {
  "id": 82,
  "q": "Model 1 break down",
  "a": "Trading strat",
  "t": "Premium"
 },
 {
  "id": 83,
  "q": "Model 1",
  "a": "Trading strat",
  "t": "Premium"
 }
];

export default {
  data: new SlashCommandBuilder()
    .setName('importqa')
    .setDescription('One-time import of the Q&A database (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: ['Ephemeral'] });
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS qa_pairs (
        id SERIAL PRIMARY KEY,
        questions TEXT UNIQUE,
        answers TEXT NOT NULL,
        tier TEXT DEFAULT 'Rookie'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS question_usage (
        id SERIAL PRIMARY KEY,
        user_id TEXT UNIQUE,
        count INTEGER DEFAULT 0,
        last_reset DATE DEFAULT CURRENT_DATE
      )`);

      let added = 0;
      for (const r of ROWS) {
        const res = await pool.query(
          'INSERT INTO qa_pairs (id, questions, answers, tier) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [r.id, r.q, r.a, r.t]
        );
        added += res.rowCount;
      }
      await pool.query("SELECT setval(pg_get_serial_sequence('qa_pairs', 'id'), (SELECT COALESCE(MAX(id), 1) FROM qa_pairs))");

      // Restore the old server settings (logging channel, disabled categories, etc.)
      const guildId = interaction.guildId || GUILD_ID_OLD;
      await pool.query(
        `INSERT INTO guilds (id, config) VALUES ($1, $2::jsonb)
         ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = CURRENT_TIMESTAMP`,
        [guildId, JSON.stringify(GUILD_CONFIG)]
      );

      const total = await pool.query('SELECT COUNT(*) FROM qa_pairs');
      await interaction.editReply(`Done. Added ${added} questions and restored server settings. Total in database: ${total.rows[0].count}.`);
    } catch (err) {
      console.error('importqa failed:', err);
      await interaction.editReply(`Import failed: ${err.message}`);
    }
  },
};
