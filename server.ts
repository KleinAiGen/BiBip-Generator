import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import rateLimit from "express-rate-limit";
import * as bip39 from "bip39";
import * as bitcoin from "bitcoinjs-lib";
import * as bip32 from "bip32";
import { ethers } from "ethers";
import * as ecc from "tiny-secp256k1";
import crypto from "crypto";

bitcoin.initEccLib(ecc);
const bip32Factory = bip32.BIP32Factory(ecc);

/**
 * Custom Error class for API responses
 */
class APIError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = "APIError";
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const PORT = 3000;

  app.use(express.json());

  // 🛡️ Rate Limiting: Prevent abuse of the API
  const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 1000, // Increased limit for bulk operations
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." }
  });

  app.use("/api/", apiLimiter);

  // 🩺 Health Check Endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "healthy", 
      uptime: process.uptime(), 
      timestamp: Date.now(),
      memoryUsage: process.memoryUsage()
    });
  });

  app.post("/api/generate", (req, res, next) => {
    try {
      // 128 bits of entropy = 12 words
      const entropy = crypto.randomBytes(16);
      const mnemonic = bip39.entropyToMnemonic(entropy);
      res.json({
        entropy: entropy.toString("hex"),
        mnemonic
      });
    } catch (error: any) {
      next(new APIError(500, `Generation failed: ${error.message}`));
    }
  });

  app.post("/api/derive", (req, res, next) => {
    try {
      const { mnemonic, count = 1, startIndex = 0 } = req.body;
      if (!mnemonic || typeof mnemonic !== 'string') {
        throw new APIError(400, "Mnemonic is required and must be a string");
      }
      if (!bip39.validateMnemonic(mnemonic)) {
        throw new APIError(400, "Invalid mnemonic phrase");
      }

      const safeCount = Math.min(Math.max(1, count), 100); // Cap between 1 and 100
      const safeStartIndex = Math.max(0, startIndex);
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      const root = bip32Factory.fromSeed(seed);

      const wallets = [];

      for (let i = safeStartIndex; i < safeStartIndex + safeCount; i++) {
        // ETH Derivation
        const ethPath = `m/44'/60'/0'/0/${i}`;
        const ethNode = root.derivePath(ethPath);
        const ethWallet = new ethers.Wallet(Buffer.from(ethNode.privateKey!).toString('hex'));
        
        // BTC Derivation (Legacy P2PKH)
        const btcPath = `m/44'/0'/0'/0/${i}`;
        const btcChild = root.derivePath(btcPath);
        const btcAddress = bitcoin.payments.p2pkh({
          pubkey: Buffer.from(btcChild.publicKey),
          network: bitcoin.networks.bitcoin,
        }).address;

        // BTC Derivation (Native SegWit P2WPKH)
        const btcSegwitPath = `m/84'/0'/0'/0/${i}`;
        const btcSegwitChild = root.derivePath(btcSegwitPath);
        const btcSegwitAddress = bitcoin.payments.p2wpkh({
          pubkey: Buffer.from(btcSegwitChild.publicKey),
          network: bitcoin.networks.bitcoin,
        }).address;

        wallets.push({
          index: i,
          eth: ethWallet.address,
          btc: btcAddress,
          btcSegwit: btcSegwitAddress
        });
      }

      res.json({ wallets });
    } catch (error: any) {
      next(error instanceof APIError ? error : new APIError(500, error.message));
    }
  });

  app.post("/api/get-balances", async (req, res, next) => {
    const { eth, btc } = req.body;
    try {
      if (!eth || !btc) {
        throw new APIError(400, "ETH and BTC addresses are required");
      }
      
      // Fetch ETH balance using public API
      let ethBalance = BigInt(0);
      try {
        const ethRes = await fetch(`https://api.blockcypher.com/v1/eth/main/addrs/${eth}/balance`);
        if (ethRes.ok) {
          const ethData = await ethRes.json();
          ethBalance = BigInt(ethData.balance);
        }
      } catch (e) {
        console.error(`ETH balance fetch failed`, e);
      }
      
      // Fetch BTC Mainnet balance
      const btcMainnetRes = await fetch(`https://blockchain.info/q/addressbalance/${btc}`);
      const btcMainnetSats = btcMainnetRes.ok ? await btcMainnetRes.text() : '0';
      
      // Fetch BTC Testnet balance
      const btcTestnetRes = await fetch(`https://api.blockcypher.com/v1/btc/test3/addrs/${btc}/balance`);
      const btcTestnetData = btcTestnetRes.ok ? await btcTestnetRes.json() : { balance: 0 };
      
      res.json({
        ethBalance: ethers.formatEther(ethBalance),
        btcMainnetBalance: (parseInt(btcMainnetSats) / 1e8).toString(),
        btcTestnetBalance: (btcTestnetData.balance / 1e8).toString()
      });
    } catch (error: any) {
      next(new APIError(500, error.message));
    }
  });

  app.post("/api/test-sequence", (req, res, next) => {
    try {
      const iterations = Math.min(req.body.iterations || 100, 1000); // Cap at 1000 to prevent event loop blocking
      const results = [];
      let totalProcessingTime = 0;

      for (let i = 0; i < iterations; i++) {
        const startTime = performance.now();
        
        // Mock wallet generation
        const walletId = crypto.randomUUID();
        
        // Mock derivation
        const derived = [1, 2, 3].map(j => `0xtest_derived_${j}_${crypto.randomBytes(16).toString('hex')}`);
        
        const elapsed = (performance.now() - startTime) / 1000; // seconds
        totalProcessingTime += elapsed;
        
        results.push({
          iteration: i + 1,
          wallet_id: walletId,
          derived_addresses: derived.length,
          processing_time: elapsed,
          performance_metric: elapsed > 0 ? `${(1/elapsed).toFixed(2)} ops/sec` : '0.00 ops/sec',
          status: 'test_successful'
        });
      }

      res.json({
        test_summary: {
          total_iterations: iterations,
          successful: results.length,
          failed: 0,
          total_processing_time: totalProcessingTime,
          average_ops_sec: totalProcessingTime > 0 ? (iterations / totalProcessingTime).toFixed(2) : 0
        },
        iterations: results.map(r => ({
          ...r,
          mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
          btc: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          eth: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
        }))
      });
    } catch (error: any) {
      next(new APIError(500, error.message));
    }
  });

  // Global Error Handler Middleware
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(`[Error] ${req.method} ${req.url} - ${err.message}`);
    if (err instanceof APIError) {
      res.status(err.statusCode).json({ error: err.message });
    } else {
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
