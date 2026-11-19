-- ============================================================================
-- RetroMarket Production Relational Database Schema (Migration 001)
-- SQLite with strict foreign keys, check constraints, and query indexes.
-- Zero sample or demonstration data is inserted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  location TEXT NOT NULL DEFAULT '',
  specialty TEXT NOT NULL DEFAULT '',
  response_time TEXT NOT NULL DEFAULT 'Within 24 hours',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  category_id INTEGER NOT NULL,
  seller_id INTEGER NOT NULL,
  condition TEXT NOT NULL DEFAULT 'Used - Tested',
  availability TEXT NOT NULL DEFAULT 'In Stock',
  stock_quantity INTEGER NOT NULL DEFAULT 1 CHECK (stock_quantity >= 0),
  in_stock INTEGER NOT NULL DEFAULT 1 CHECK (in_stock IN (0, 1)),
  is_digital INTEGER NOT NULL DEFAULT 0 CHECK (is_digital IN (0, 1)),
  shipping_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cost_cents >= 0),
  shipping_method TEXT NOT NULL DEFAULT 'Standard Ground Shipping',
  shipping_handling TEXT NOT NULL DEFAULT 'Ships within 2 business days',
  shipping_from TEXT NOT NULL DEFAULT '',
  return_policy TEXT NOT NULL DEFAULT '14-day return policy',
  image_url TEXT NOT NULL DEFAULT 'assets/images/retro-keyboard.jpg',
  gallery_json TEXT NOT NULL DEFAULT '[]',
  specs_json TEXT NOT NULL DEFAULT '{}',
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_country TEXT NOT NULL,
  customer_city TEXT NOT NULL,
  shipping_address TEXT NOT NULL DEFAULT '',
  requires_shipping INTEGER NOT NULL DEFAULT 1 CHECK (requires_shipping IN (0, 1)),
  customer_notes TEXT NOT NULL DEFAULT '',
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents INTEGER NOT NULL CHECK (shipping_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cybersource', 'cryptocurrency', 'manual')),
  payment_status TEXT NOT NULL DEFAULT 'Pending' CHECK (
    payment_status IN ('Pending', 'Awaiting Verification', 'Paid', 'Failed', 'Cancelled', 'Refunded')
  ),
  order_status TEXT NOT NULL DEFAULT 'Pending' CHECK (
    order_status IN ('Pending', 'Processing', 'Shipped', 'Completed', 'Cancelled')
  ),
  internal_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  seller_username TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  line_shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (line_shipping_cents >= 0),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_ref TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cybersource', 'cryptocurrency', 'manual')),
  provider TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  expected_amount_cents INTEGER NOT NULL CHECK (expected_amount_cents >= 0),
  crypto_currency TEXT,
  crypto_expected_amount TEXT,
  crypto_wallet_address TEXT,
  crypto_network TEXT,
  provider_transaction_id TEXT UNIQUE,
  tx_hash TEXT UNIQUE,
  confirmations INTEGER NOT NULL DEFAULT 0 CHECK (confirmations >= 0),
  required_confirmations INTEGER NOT NULL DEFAULT 0 CHECK (required_confirmations >= 0),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (
    status IN ('Pending', 'Awaiting Verification', 'Paid', 'Failed', 'Cancelled', 'Refunded')
  ),
  expires_at TEXT,
  verified_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  raw_provider_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS website_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site_name TEXT NOT NULL DEFAULT 'RetroMarket',
  tagline TEXT NOT NULL DEFAULT 'Classic Online Buying & Selling Directory',
  logo_path TEXT NOT NULL DEFAULT 'assets/icons/logo-mark.svg',
  default_currency TEXT NOT NULL DEFAULT 'USD' CHECK (default_currency IN ('USD', 'EUR', 'GBP', 'CAD')),
  support_email TEXT NOT NULL DEFAULT '',
  seller_contact_info TEXT NOT NULL DEFAULT '',
  guest_checkout_notice TEXT NOT NULL DEFAULT 'Shop and check out as a guest without creating a customer account. Save your Order Reference ID to track your order.',
  btc_wallet_address TEXT NOT NULL DEFAULT '',
  eth_wallet_address TEXT NOT NULL DEFAULT '',
  usdt_wallet_address TEXT NOT NULL DEFAULT '',
  usdt_network TEXT NOT NULL DEFAULT 'ERC-20',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  admin_user_id INTEGER NOT NULL,
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  admin_user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS seller_inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_ref TEXT NOT NULL UNIQUE,
  recipient TEXT NOT NULL,
  product_id INTEGER,
  order_number TEXT NOT NULL DEFAULT '',
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  message TEXT NOT NULL,
  email_delivered INTEGER NOT NULL DEFAULT 0 CHECK (email_delivered IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER,
  admin_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

-- Indexes for fast catalog filtering, order lookup, session validation, and payment verification
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_price_cents ON products(price_cents);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status, payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_inquiries_created_at ON seller_inquiries(created_at DESC);
