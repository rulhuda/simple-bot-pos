// File: index.js
// require("dotenv").config();
import "dotenv/config";
import path from "path";
import fs from "fs";
import TelegramBot from "node-telegram-bot-api";
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import express from "express";
import createError from "http-errors";
import morgan from "morgan";

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "your_bot_token";
const bot = new TelegramBot(TOKEN);
// const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
//   polling: true,
//   allowedUpdates: ["message", "callback_query"],
// });
const url =
  process.env.URL_WEBHOOK || "https://your-webhook-url.com/telegram-webhook";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const app = express();

const cartCache = {}; // In-memory cache to track cart item order per user

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan("dev"));
// app.use(express.static(path.join(process.cwd(), "public")));

bot.setWebHook(`${url}/bot${TOKEN}`);

// Handle webhook route
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.onText(/\/start/, (msg) => {
  // const stream = fs.createReadStream("public/img/menu_queenan.jpg");
  let chatId = msg.chat.id;

  // bot.sendPhoto(chatId, stream, {
  //   caption: "Menu Queenan Tea",
  // });
  // bot.sendMessage(
  //   chatId,
  //   "Selamat Datang di POS Queenan Tea Bot!\nGunakan perintah /addproduct, /list, /buy, /cart, /checkout."
  // );
  bot.sendMessage(
    chatId,
    "👋 Selamat Datang di POS Queenan Tea!\nGunakan perintah:\n/addproduct untuk menambahkan product, \n/list untuk melihat list produk, \n/buy untuk menambahkan ke keranjang, \n/cart untuk melihat isi keranjang, \n/checkout untuk finalisasi pembayaran.",
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🧾 Lihat Produk", callback_data: "list" },
            { text: "🛒 Lihat Keranjang", callback_data: "lihat_keranjang" },
          ],
          // [{ text: "🛒 Lihat Keranjang", callback_data: "lihat_keranjang" }],
        ],
      },
    }
  );
});

bot.onText(/\/addproduct(?:\s+(.+?)\s+(\d+))?$/, async (msg, match) => {
  const name = match?.[1];
  const price = parseInt(match?.[2]);

  // If name or price is missing or invalid
  if (!name || isNaN(price) || price <= 0) {
    return bot.sendMessage(
      msg.chat.id,
      "Invalid product format.\nUse: /addproduct <name> <price>"
    );
  }

  try {
    const { error } = await supabase.from("products").insert([{ name, price }]);

    if (error) {
      throw error;
    }

    return bot.sendMessage(
      msg.chat.id,
      `✅ Product "${name}" added with price ${price}`
    );
  } catch (err) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Failed to add product: " + err.message
    );
  }
});

bot.onText(/\/list/, async (msg) => {
  const { data, error } = await supabase.from("products").select("*");

  if (error) return bot.sendMessage(msg.chat.id, "Error fetching products");

  const text = data
    .map((p, i) => `${i + 1}. ${p.name} - Rp${p.price} (ID: ${p.id})`)
    .join("\n");
  if (!text) return bot.sendMessage(msg.chat.id, "Produk tidak tersedia.");
  let res = `🍺 Produk Tersedia:\n${text}\n\Gunakan perintah /buy <product_id> <quantity> to purchase.`;
  bot.sendMessage(msg.chat.id, res);
});

bot.onText(/\/buy(?:\s+(\d+)\s+(\d+))?$/, async (msg, match) => {
  const productId = parseInt(match?.[1]);
  const qty = parseInt(match?.[2]);
  const userId = msg.from.id;

  // Validate input
  if (isNaN(productId) || isNaN(qty) || qty <= 0) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Perintah tidak validGunakan: /buy <product_id> <quantity>"
    );
  }

  try {
    const { error } = await supabase.from("cart").insert([
      {
        buyer_id: userId,
        product_id: productId,
        quantity: qty,
      },
    ]);

    if (error) throw error;

    // return bot.sendMessage(msg.chat.id, "✅ Item added to cart.");
    bot.sendMessage(msg.chat.id, "✅ Item ditambahkan ke keranjang.", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛒 Lihat Keranjang", callback_data: "lihat_keranjang" }],
        ],
      },
    });
  } catch (err) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Failed to add item: " + err.message
    );
  }
});

bot.onText(/\/cart/, async (msg) => {
  const userId = msg.from.id;

  const { data: cartItems, error } = await supabase
    .from("cart")
    .select("id, quantity, products(name, price)")
    .eq("buyer_id", userId);

  if (error || !cartItems || cartItems.length === 0) {
    return bot.sendMessage(msg.chat.id, "🛒 Keranjang kosong.");
  }

  cartCache[userId] = cartItems;

  let message = "🧾 Isi Keranjang:\n";
  let total = 0;

  cartItems.forEach((item, index) => {
    const { name, price } = item.products;
    const subtotal = price * item.quantity;
    total += subtotal;
    message += `${index + 1}. ${name} x${
      item.quantity
    } @Rp${price} = Rp${subtotal}\n`;
  });

  message += `\n💰 Total: Rp${total}`;
  message += `\nGunakan /removecart <no> untuk menghapus item atau /cancelcart (or /cancelbuy) untuk menghapus semua item di keranjang dan /checkout untuk finalisasi pembayaran.`;

  bot.sendMessage(msg.chat.id, message);
});

bot.onText(/\/removecart (\d+)/, async (msg, match) => {
  const userId = msg.from.id;
  const index = parseInt(match[1]) - 1;

  const cartItems = cartCache[userId];
  if (!cartItems || !cartItems[index]) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Nomor item tidak valid. Gunakan /cart untuk melihat nomor yang valid."
    );
  }

  const itemId = cartItems[index].id;

  const { error } = await supabase.from("cart").delete().eq("id", itemId);
  if (error)
    return bot.sendMessage(
      msg.chat.id,
      "❌ Gagal menghapus item: " + error.message
    );

  bot.sendMessage(
    msg.chat.id,
    `🗑️ Menghapus item #${index + 1} dari keranjang.`
  );
});

bot.onText(/\/(cancelcart|cancelbuy)/, async (msg) => {
  const userId = msg.from.id;
  const { error } = await supabase.from("cart").delete().eq("buyer_id", userId);

  if (error) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Gagal untuk membatalkan pembelian."
    );
  }

  bot.sendMessage(
    msg.chat.id,
    "🛑 Pembelian dibatalkan. Keranjang anda sekarang kosong."
  );
});

bot.onText(/\/checkout/, async (msg) => {
  const userId = msg.from.id;

  const { data: cartItems, error: fetchErr } = await supabase
    .from("cart")
    .select("product_id, quantity, products(name, price)")
    .eq("buyer_id", userId);

  if (fetchErr || !cartItems || cartItems.length === 0) {
    return bot.sendMessage(
      msg.chat.id,
      "Keranjang anda kosong. Silakan tambahkan produk terlebih dahulu."
    );
  }

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({ buyer_id: userId })
    .select()
    .single();

  const items = cartItems.map((item) => ({
    transaction_id: tx.id,
    product_id: item.product_id,
    quantity: item.quantity,
    price_at_purchase: item.products.price,
  }));

  await supabase.from("transaction_items").insert(items);
  await supabase.from("cart").delete().eq("buyer_id", userId);
  let message = ``;
  let total = 0;

  cartItems.forEach((item, index) => {
    const { name, price } = item.products;
    const subtotal = price * item.quantity;
    total += subtotal;
    message += `${index + 1}. ${name} x${
      item.quantity
    } @Rp${price} = Rp${subtotal}\n`;
  });

  message += `\n💰 Total: Rp${total}`;
  message += `\n✅ Transaksi berhasil.\n`;

  bot.sendMessage(msg.chat.id, message);
});

// Report Command
bot.onText(/\/report (today|day|week|month|year)/, async (msg, match) => {
  const range = match[1];
  const userId = msg.from.id;

  let fromDate;
  const now = DateTime.now().setZone("Asia/Jakarta");

  switch (range) {
    case "today":
      fromDate = now.startOf("day").toISO();
      break;
    case "day":
      fromDate = now.minus({ days: 1 }).toISO();
      break;
    case "week":
      fromDate = now.startOf("week").toISO();
      break;
    case "month":
      fromDate = now.startOf("month").toISO();
      break;
    case "year":
      fromDate = now.startOf("year").toISO();
      break;
    default:
      return bot.sendMessage(msg.chat.id, "Invalid report range.");
  }

  const { data: transactions, error } = await supabase
    .from("transactions")
    .select(
      "id, created_at, transaction_items(quantity, price_at_purchase, products(name))"
    )
    .gte("created_at", fromDate)
    .eq("buyer_id", userId);

  if (error || !transactions || transactions.length === 0) {
    return bot.sendMessage(
      msg.chat.id,
      "No transactions found for this period."
    );
  }

  let total = 0;
  let message = `📊 Report for ${range.toUpperCase()}\n\n`;

  transactions.forEach((tx, i) => {
    message += `#${i + 1} ${DateTime.fromISO(tx.created_at).toFormat(
      "dd LLL yyyy HH:mm"
    )}\n`;
    tx.transaction_items.forEach((item) => {
      const subtotal = item.quantity * item.price_at_purchase;
      total += subtotal;
      message += `- ${item.products.name} x${item.quantity} = Rp${subtotal}\n`;
    });
    message += "\n";
  });

  message += `💰 Total: Rp${total}`;
  bot.sendMessage(msg.chat.id, message);
});

bot.on("callback_query", async (callbackQuery) => {
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;

  console.log("callbackQuery received:", callbackQuery);
  console.log("data =", data);
  console.log("userId =", userId);
  console.log("chatId =", chatId);

  // Always answer first to stop spinner
  await bot.answerCallbackQuery(callbackQuery.id);

  if (data === "lihat_keranjang") {
    const { data: cartItems, error } = await supabase
      .from("cart")
      .select("id, quantity, products(name, price)")
      .eq("buyer_id", userId);

    if (error || !cartItems || cartItems.length === 0) {
      return bot.sendMessage(chatId, "🛒 Keranjang kosong.");
    }

    cartCache[userId] = cartItems;

    let message = "🛒 Isi Keranjang:\n";
    let total = 0;

    cartItems.forEach((item, index) => {
      const { name, price } = item.products;
      const subtotal = price * item.quantity;
      total += subtotal;
      message += `${index + 1}. ${name} x${
        item.quantity
      } @Rp${price} = Rp${subtotal}\n`;
    });

    message += `\n💰 Total: Rp${total}`;
    message += `\nGunakan /removecart <no> untuk menghapus item atau /cancelcart (or /cancelbuy) untuk menghapus semua item di keranjang dan /checkout untuk finalisasi pembayaran.`;
    return await bot.sendMessage(chatId, message);
  } else if (data === "list") {
    const { data: products, error } = await supabase
      .from("products")
      .select("*");

    if (error || !products || products.length === 0) {
      return await bot.sendMessage(chatId, "Produk tidak tersedia.");
    }

    const text = products
      .map((p, i) => `${i + 1}. ${p.name} - Rp${p.price} (ID: ${p.id})`)
      .join("\n");
    let res = `🍺 Produk Tersedia:\n${text}\n\nUse /buy <product_id> <quantity> to purchase.`;
    return await bot.sendMessage(chatId, res);
  } else if (data === "checkout") {
    return await bot.sendMessage(chatId, "✅ Silakan lanjut ke pembayaran...");
  }

  // Memberi respons ke Telegram agar loading spinner hilang
  // bot.answerCallbackQuery(callbackQuery.id);
});

app.get("/", (req, res, next) => {
  res.send("APP POS is running!");
});

app.use((req, res, next) => {
  next(createError.NotFound());
});

app.use((err, req, res, next) => {
  res.status(err.status || 500);
  res.send({
    status: err.status || 500,
    message: err.message,
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
