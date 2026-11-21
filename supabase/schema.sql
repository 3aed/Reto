-- ============================================================================
-- RetroMarket — Production Supabase PostgreSQL Schema, RLS Policies & Storage
-- ============================================================================
-- Run this script once in your Supabase SQL Editor.
-- Zero demonstration/sample products, sellers, or orders are inserted.
--
-- After running this schema:
-- 1. Create your administrator user in Supabase Dashboard -> Authentication -> Users.
-- 2. Grant that user admin access by running:
--      INSERT INTO public.admin_users (user_id, email, role, active)
--      VALUES ('<AUTH_USER_UUID>', '<ADMIN_EMAIL>', 'super_admin', true);
-- ============================================================================

-- 1. Administrator Registry (links Supabase Auth users to RetroMarket Admin access)
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin', 'admin')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helper used by all RLS policies (runs as definer to avoid recursive policy checks)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.user_id = auth.uid()
      AND au.active = TRUE
  );
$$;

-- Shared updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 2. Catalog Categories
CREATE TABLE IF NOT EXISTS public.categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Marketplace Sellers
CREATE TABLE IF NOT EXISTS public.sellers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  specialty TEXT NOT NULL DEFAULT '',
  response_time TEXT NOT NULL DEFAULT 'Within 24 hours',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  telegram TEXT NOT NULL DEFAULT '',
  other_contact_url TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allow multiple sellers without an email while still enforcing uniqueness for non-empty emails
ALTER TABLE public.sellers DROP CONSTRAINT IF EXISTS sellers_email_key;
ALTER TABLE public.sellers ALTER COLUMN email SET DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_email_unique
  ON public.sellers (LOWER(email))
  WHERE email <> '';

-- 4. Catalog Products
CREATE TABLE IF NOT EXISTS public.products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  category_id BIGINT NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  seller_id BIGINT NOT NULL REFERENCES public.sellers(id) ON DELETE RESTRICT,
  condition TEXT NOT NULL DEFAULT 'Used - Tested',
  availability TEXT NOT NULL DEFAULT 'In Stock',
  stock_quantity INTEGER NOT NULL DEFAULT 1 CHECK (stock_quantity >= 0),
  in_stock BOOLEAN NOT NULL DEFAULT TRUE,
  is_digital BOOLEAN NOT NULL DEFAULT FALSE,
  shipping_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cost_cents >= 0),
  shipping_method TEXT NOT NULL DEFAULT 'Standard Ground Shipping',
  shipping_handling TEXT NOT NULL DEFAULT 'Ships within 2 business days',
  shipping_from TEXT NOT NULL DEFAULT '',
  return_policy TEXT NOT NULL DEFAULT '14-day return policy',
  image_url TEXT NOT NULL DEFAULT 'assets/images/retro-keyboard.jpg',
  gallery_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  specs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  seller_contact_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Manual Cryptocurrency Payment Options (Admin-Managed, No Blockchain APIs)
CREATE TABLE IF NOT EXISTS public.crypto_payment_methods (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  network TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  qr_code_url TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Guest Orders
CREATE TABLE IF NOT EXISTS public.orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_country TEXT NOT NULL,
  customer_city TEXT NOT NULL,
  shipping_address TEXT NOT NULL DEFAULT '',
  requires_shipping BOOLEAN NOT NULL DEFAULT TRUE,
  customer_notes TEXT NOT NULL DEFAULT '',
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents INTEGER NOT NULL CHECK (shipping_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cybersource', 'cryptocurrency', 'manual')),
  payment_status TEXT NOT NULL DEFAULT 'Pending' CHECK (
    payment_status IN ('Pending', 'Pending Verification', 'Paid', 'Failed', 'Cancelled', 'Refunded')
  ),
  order_status TEXT NOT NULL DEFAULT 'Pending' CHECK (
    order_status IN ('Pending', 'Processing', 'Shipped', 'Completed', 'Cancelled')
  ),
  internal_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Order Line Items
CREATE TABLE IF NOT EXISTS public.order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  seller_username TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  line_shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (line_shipping_cents >= 0)
);

-- 8. Payment Records (Manual Crypto & Manual Seller Reconciliation)
CREATE TABLE IF NOT EXISTS public.payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_ref TEXT NOT NULL UNIQUE,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cybersource', 'cryptocurrency', 'manual')),
  provider TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  expected_amount_cents INTEGER NOT NULL CHECK (expected_amount_cents >= 0),
  crypto_method_id BIGINT REFERENCES public.crypto_payment_methods(id) ON DELETE SET NULL,
  crypto_currency TEXT,
  crypto_network TEXT,
  crypto_wallet_address TEXT,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (
    status IN ('Pending', 'Pending Verification', 'Paid', 'Failed', 'Cancelled', 'Refunded')
  ),
  verified_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Website Settings (Singleton row id = 1)
CREATE TABLE IF NOT EXISTS public.website_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site_name TEXT NOT NULL DEFAULT 'RetroMarket',
  tagline TEXT NOT NULL DEFAULT 'Classic Online Buying & Selling Directory',
  logo_path TEXT NOT NULL DEFAULT 'assets/icons/logo-mark.svg',
  default_currency TEXT NOT NULL DEFAULT 'USD' CHECK (default_currency IN ('USD', 'EUR', 'GBP', 'CAD')),
  support_email TEXT NOT NULL DEFAULT '',
  seller_contact_info TEXT NOT NULL DEFAULT '',
  guest_checkout_notice TEXT NOT NULL DEFAULT 'Shop and check out as a guest without creating a customer account. Save your Order Reference ID to track your order.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.website_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 10. Guest Seller & Support Inquiries
CREATE TABLE IF NOT EXISTS public.seller_inquiries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inquiry_ref TEXT NOT NULL UNIQUE,
  recipient TEXT NOT NULL,
  product_id BIGINT REFERENCES public.products(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL DEFAULT '',
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Administrative Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON public.products(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_price_cents ON public.products(price_cents);
CREATE INDEX IF NOT EXISTS idx_products_featured ON public.products(featured);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON public.products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_order_number_lower ON public.orders(LOWER(order_number));
CREATE INDEX IF NOT EXISTS idx_orders_customer_email_lower ON public.orders(LOWER(customer_email));
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_inquiries_created_at ON public.seller_inquiries(created_at DESC);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON public.admin_users;
CREATE TRIGGER trg_admin_users_updated_at BEFORE UPDATE ON public.admin_users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_categories_updated_at ON public.categories;
CREATE TRIGGER trg_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_sellers_updated_at ON public.sellers;
CREATE TRIGGER trg_sellers_updated_at BEFORE UPDATE ON public.sellers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_crypto_methods_updated_at ON public.crypto_payment_methods;
CREATE TRIGGER trg_crypto_methods_updated_at BEFORE UPDATE ON public.crypto_payment_methods FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_website_settings_updated_at ON public.website_settings;
CREATE TRIGGER trg_website_settings_updated_at BEFORE UPDATE ON public.website_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crypto_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- admin_users: authenticated admin can read their own row; super_admin can manage
DROP POLICY IF EXISTS "Admins read own record" ON public.admin_users;
CREATE POLICY "Admins read own record"
  ON public.admin_users FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Admins update own last login" ON public.admin_users;
CREATE POLICY "Admins update own last login"
  ON public.admin_users FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND active = TRUE)
  WITH CHECK (user_id = auth.uid() AND active = TRUE);

-- categories: public read, admin write
DROP POLICY IF EXISTS "Public read categories" ON public.categories;
CREATE POLICY "Public read categories"
  ON public.categories FOR SELECT
  TO anon, authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Admins manage categories" ON public.categories;
CREATE POLICY "Admins manage categories"
  ON public.categories FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- sellers: public read active sellers, admin full access
DROP POLICY IF EXISTS "Public read active sellers" ON public.sellers;
CREATE POLICY "Public read active sellers"
  ON public.sellers FOR SELECT
  TO anon, authenticated
  USING (active = TRUE OR public.is_admin());

DROP POLICY IF EXISTS "Admins manage sellers" ON public.sellers;
CREATE POLICY "Admins manage sellers"
  ON public.sellers FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- products: public read, admin write
DROP POLICY IF EXISTS "Public read products" ON public.products;
CREATE POLICY "Public read products"
  ON public.products FOR SELECT
  TO anon, authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Admins manage products" ON public.products;
CREATE POLICY "Admins manage products"
  ON public.products FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- crypto_payment_methods: public read active methods, admin full access
DROP POLICY IF EXISTS "Public read active crypto methods" ON public.crypto_payment_methods;
CREATE POLICY "Public read active crypto methods"
  ON public.crypto_payment_methods FOR SELECT
  TO anon, authenticated
  USING (active = TRUE OR public.is_admin());

DROP POLICY IF EXISTS "Admins manage crypto methods" ON public.crypto_payment_methods;
CREATE POLICY "Admins manage crypto methods"
  ON public.crypto_payment_methods FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- website_settings: public read, admin update
DROP POLICY IF EXISTS "Public read website settings" ON public.website_settings;
CREATE POLICY "Public read website settings"
  ON public.website_settings FOR SELECT
  TO anon, authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Admins update website settings" ON public.website_settings;
CREATE POLICY "Admins update website settings"
  ON public.website_settings FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- orders, order_items, payments, seller_inquiries, audit_logs: admin-only direct table access
-- (Guest checkout, order lookup, manual crypto submission, and inquiries use SECURITY DEFINER RPCs below)
DROP POLICY IF EXISTS "Admins manage orders" ON public.orders;
CREATE POLICY "Admins manage orders"
  ON public.orders FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage order items" ON public.order_items;
CREATE POLICY "Admins manage order items"
  ON public.order_items FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage payments" ON public.payments;
CREATE POLICY "Admins manage payments"
  ON public.payments FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage inquiries" ON public.seller_inquiries;
CREATE POLICY "Admins manage inquiries"
  ON public.seller_inquiries FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins read and insert audit logs" ON public.audit_logs;
CREATE POLICY "Admins read and insert audit logs"
  ON public.audit_logs FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- SECURE GUEST RPC FUNCTIONS (SECURITY DEFINER, NO SERVICE ROLE KEY NEEDED)
-- ============================================================================

-- Helper to assemble a safe public order JSON payload
CREATE OR REPLACE FUNCTION public.build_order_payload(p_order_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_items JSONB;
  v_payments JSONB;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.product_id,
        'name', oi.product_name,
        'seller', oi.seller_username,
        'qty', oi.quantity,
        'unitPrice', ROUND(oi.unit_price_cents / 100.0, 2),
        'lineTotal', ROUND(oi.line_total_cents / 100.0, 2),
        'lineShipping', ROUND(oi.line_shipping_cents / 100.0, 2)
      )
      ORDER BY oi.id ASC
    ),
    '[]'::jsonb
  ) INTO v_items
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'paymentRef', p.payment_ref,
        'method', p.method,
        'provider', p.provider,
        'amount', ROUND(p.expected_amount_cents / 100.0, 2),
        'currency', p.currency,
        'cryptoMethodId', p.crypto_method_id,
        'cryptoCurrency', p.crypto_currency,
        'cryptoNetwork', p.crypto_network,
        'cryptoWalletAddress', p.crypto_wallet_address,
        'transactionRef', COALESCE(p.tx_hash, ''),
        'status', p.status,
        'reviewNote', p.review_note,
        'verifiedAt', p.verified_at,
        'createdAt', TO_CHAR(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
      )
      ORDER BY p.id DESC
    ),
    '[]'::jsonb
  ) INTO v_payments
  FROM public.payments p
  WHERE p.order_id = v_order.id;

  RETURN jsonb_build_object(
    'orderNumber', v_order.order_number,
    'createdAt', TO_CHAR(v_order.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    'currency', v_order.currency,
    'paymentMethod', v_order.payment_method,
    'paymentMethodLabel',
      CASE v_order.payment_method
        WHEN 'cybersource' THEN 'CyberSource (Currently Unavailable)'
        WHEN 'cryptocurrency' THEN 'Cryptocurrency (Manual Verification)'
        ELSE 'Contact Seller / Manual Payment'
      END,
    'paymentStatus', v_order.payment_status,
    'orderStatus', v_order.order_status,
    'subtotal', ROUND(v_order.subtotal_cents / 100.0, 2),
    'shipping', ROUND(v_order.shipping_cents / 100.0, 2),
    'total', ROUND(v_order.total_cents / 100.0, 2),
    'customer', jsonb_build_object(
      'fullName', v_order.customer_name,
      'email', v_order.customer_email,
      'phone', v_order.customer_phone,
      'country', v_order.customer_country,
      'city', v_order.customer_city,
      'shippingAddress', v_order.shipping_address,
      'requiresShipping', v_order.requires_shipping,
      'notes', v_order.customer_notes
    ),
    'products', v_items,
    'payments', v_payments
  );
END;
$$;

-- 1. Atomic Guest Checkout Order Creation (recalculates prices & decrements stock server-side)
CREATE OR REPLACE FUNCTION public.create_guest_order(
  p_order_number TEXT,
  p_full_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_country TEXT,
  p_city TEXT,
  p_shipping_address TEXT,
  p_notes TEXT,
  p_payment_method TEXT,
  p_items JSONB,
  p_manual_payment_ref TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency TEXT;
  v_subtotal_cents INTEGER := 0;
  v_shipping_cents INTEGER := 0;
  v_total_cents INTEGER := 0;
  v_requires_shipping BOOLEAN := FALSE;
  v_order_id BIGINT;
  v_item JSONB;
  v_prod RECORD;
  v_qty INTEGER;
  v_line_total INTEGER;
  v_line_shipping INTEGER;
  v_new_stock INTEGER;
  v_initial_payment_status TEXT;
BEGIN
  IF p_payment_method NOT IN ('cybersource', 'cryptocurrency', 'manual') THEN
    RAISE EXCEPTION 'Invalid payment method.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Your shopping cart is empty.';
  END IF;

  SELECT COALESCE(default_currency, 'USD') INTO v_currency FROM public.website_settings WHERE id = 1;
  IF v_currency IS NULL THEN
    v_currency := 'USD';
  END IF;

  -- First pass: lock product rows, validate availability & compute authoritative totals
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := COALESCE((v_item->>'qty')::INTEGER, 0);
    IF v_qty <= 0 OR v_qty > 99 THEN
      RAISE EXCEPTION 'Invalid product quantity requested.';
    END IF;

    SELECT p.*, s.username AS seller_username
    INTO v_prod
    FROM public.products p
    JOIN public.sellers s ON s.id = p.seller_id
    WHERE p.id = (v_item->>'id')::BIGINT
    FOR UPDATE OF p;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'One or more products in your cart are no longer available.';
    END IF;

    IF NOT v_prod.in_stock OR v_prod.stock_quantity < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for "%". Available: %.', v_prod.name, v_prod.stock_quantity;
    END IF;

    v_line_total := v_prod.price_cents * v_qty;
    v_line_shipping := CASE WHEN v_prod.is_digital THEN 0 ELSE v_prod.shipping_cost_cents END;
    IF NOT v_prod.is_digital THEN
      v_requires_shipping := TRUE;
    END IF;

    v_subtotal_cents := v_subtotal_cents + v_line_total;
    v_shipping_cents := v_shipping_cents + v_line_shipping;
  END LOOP;

  IF v_requires_shipping AND LENGTH(TRIM(COALESCE(p_shipping_address, ''))) < 5 THEN
    RAISE EXCEPTION 'Shipping Address is required because your order includes physical items.';
  END IF;

  v_total_cents := v_subtotal_cents + v_shipping_cents;
  v_initial_payment_status := CASE
    WHEN p_payment_method = 'cryptocurrency' THEN 'Pending Verification'
    ELSE 'Pending'
  END;

  INSERT INTO public.orders (
    order_number, customer_name, customer_email, customer_phone,
    customer_country, customer_city, shipping_address, requires_shipping,
    customer_notes, subtotal_cents, shipping_cents, total_cents,
    currency, payment_method, payment_status, order_status
  ) VALUES (
    p_order_number,
    TRIM(p_full_name),
    LOWER(TRIM(p_email)),
    TRIM(p_phone),
    TRIM(p_country),
    TRIM(p_city),
    CASE WHEN v_requires_shipping THEN TRIM(p_shipping_address) ELSE COALESCE(NULLIF(TRIM(p_shipping_address), ''), 'Digital Delivery') END,
    v_requires_shipping,
    COALESCE(TRIM(p_notes), ''),
    v_subtotal_cents,
    v_shipping_cents,
    v_total_cents,
    v_currency,
    p_payment_method,
    v_initial_payment_status,
    'Pending'
  ) RETURNING id INTO v_order_id;

  -- Second pass: insert order items & decrement stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::INTEGER;
    SELECT p.*, s.username AS seller_username
    INTO v_prod
    FROM public.products p
    JOIN public.sellers s ON s.id = p.seller_id
    WHERE p.id = (v_item->>'id')::BIGINT;

    v_line_total := v_prod.price_cents * v_qty;
    v_line_shipping := CASE WHEN v_prod.is_digital THEN 0 ELSE v_prod.shipping_cost_cents END;

    INSERT INTO public.order_items (
      order_id, product_id, product_name, seller_username,
      unit_price_cents, quantity, line_total_cents, line_shipping_cents
    ) VALUES (
      v_order_id,
      v_prod.id,
      v_prod.name,
      v_prod.seller_username,
      v_prod.price_cents,
      v_qty,
      v_line_total,
      v_line_shipping
    );

    v_new_stock := v_prod.stock_quantity - v_qty;
    UPDATE public.products
    SET
      stock_quantity = v_new_stock,
      in_stock = CASE WHEN v_new_stock <= 0 THEN FALSE ELSE in_stock END,
      availability = CASE
        WHEN v_new_stock <= 0 THEN 'Out of Stock'
        ELSE 'In Stock (' || v_new_stock || ' available)'
      END
    WHERE id = v_prod.id;
  END LOOP;

  IF p_payment_method = 'manual' AND LENGTH(TRIM(COALESCE(p_manual_payment_ref, ''))) > 0 THEN
    INSERT INTO public.payments (
      payment_ref, order_id, method, provider, currency,
      expected_amount_cents, status, review_note
    ) VALUES (
      p_manual_payment_ref,
      v_order_id,
      'manual',
      'Direct Seller Arrangement',
      v_currency,
      v_total_cents,
      'Pending',
      'Awaiting manual payment coordination'
    );
  END IF;

  RETURN public.build_order_payload(v_order_id);
END;
$$;

-- 2. Guest Order Lookup (requires matching Order Number AND Email)
CREATE OR REPLACE FUNCTION public.lookup_guest_order(
  p_order_number TEXT,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id BIGINT;
BEGIN
  SELECT id INTO v_order_id
  FROM public.orders
  WHERE LOWER(order_number) = LOWER(TRIM(p_order_number))
    AND LOWER(customer_email) = LOWER(TRIM(p_email))
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.build_order_payload(v_order_id);
END;
$$;

-- 3. Manual Cryptocurrency Payment Submission (Always Pending Verification until Admin reviews)
CREATE OR REPLACE FUNCTION public.submit_manual_crypto_payment(
  p_order_number TEXT,
  p_email TEXT,
  p_crypto_method_id BIGINT,
  p_payment_ref TEXT,
  p_tx_reference TEXT DEFAULT '',
  p_note TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_crypto public.crypto_payment_methods%ROWTYPE;
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE LOWER(order_number) = LOWER(TRIM(p_order_number))
    AND LOWER(customer_email) = LOWER(TRIM(p_email))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found for that Order Reference ID and Email Address.';
  END IF;

  IF v_order.payment_status = 'Paid' OR v_order.order_status = 'Cancelled' THEN
    RAISE EXCEPTION 'This order can no longer accept new payment submissions.';
  END IF;

  SELECT * INTO v_crypto
  FROM public.crypto_payment_methods
  WHERE id = p_crypto_method_id AND active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected cryptocurrency payment method is not available.';
  END IF;

  INSERT INTO public.payments (
    payment_ref, order_id, method, provider, currency,
    expected_amount_cents, crypto_method_id, crypto_currency,
    crypto_network, crypto_wallet_address, tx_hash, status, review_note
  ) VALUES (
    p_payment_ref,
    v_order.id,
    'cryptocurrency',
    v_crypto.name || ' (' || v_crypto.network || ')',
    v_order.currency,
    v_order.total_cents,
    v_crypto.id,
    v_crypto.symbol,
    v_crypto.network,
    v_crypto.wallet_address,
    NULLIF(TRIM(COALESCE(p_tx_reference, '')), ''),
    'Pending Verification',
    COALESCE(NULLIF(TRIM(COALESCE(p_note, '')), ''), 'Manual cryptocurrency payment submitted by guest; awaiting admin verification.')
  );

  UPDATE public.orders
  SET payment_method = 'cryptocurrency',
      payment_status = 'Pending Verification'
  WHERE id = v_order.id;

  RETURN public.build_order_payload(v_order.id);
END;
$$;

-- 4. Guest Seller / Support Inquiry Submission
CREATE OR REPLACE FUNCTION public.submit_seller_inquiry(
  p_inquiry_ref TEXT,
  p_recipient TEXT,
  p_product_id BIGINT,
  p_order_number TEXT,
  p_guest_name TEXT,
  p_guest_email TEXT,
  p_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valid_product_id BIGINT := NULL;
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_product_id IS NOT NULL THEN
    SELECT id INTO v_valid_product_id FROM public.products WHERE id = p_product_id LIMIT 1;
  END IF;

  INSERT INTO public.seller_inquiries (
    inquiry_ref, recipient, product_id, order_number,
    guest_name, guest_email, message
  ) VALUES (
    p_inquiry_ref,
    TRIM(p_recipient),
    v_valid_product_id,
    COALESCE(TRIM(p_order_number), ''),
    TRIM(p_guest_name),
    LOWER(TRIM(p_guest_email)),
    TRIM(p_message)
  );

  IF LENGTH(TRIM(COALESCE(p_order_number, ''))) > 0 THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE LOWER(order_number) = LOWER(TRIM(p_order_number))
      AND LOWER(customer_email) = LOWER(TRIM(p_guest_email))
    LIMIT 1;

    IF FOUND AND v_order.payment_method = 'manual' AND v_order.payment_status = 'Pending' THEN
      UPDATE public.orders
      SET payment_status = 'Pending Verification'
      WHERE id = v_order.id;

      UPDATE public.payments
      SET status = 'Pending Verification',
          review_note = 'Manual payment inquiry ' || p_inquiry_ref || ' submitted by buyer'
      WHERE order_id = v_order.id
        AND method = 'manual'
        AND status = 'Pending';
    END IF;
  END IF;

  RETURN jsonb_build_object('inquiryRef', p_inquiry_ref);
END;
$$;

-- One-time initial administrator registration (succeeds ONLY when public.admin_users has 0 rows)
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_count INTEGER;
  v_row public.admin_users%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.admin_users;
  IF v_count > 0 THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid LIMIT 1;
  IF v_email IS NULL OR LENGTH(TRIM(v_email)) = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.admin_users (user_id, email, role, active)
  VALUES (v_uid, LOWER(TRIM(v_email)), 'super_admin', TRUE)
  ON CONFLICT (user_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.user_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_row.user_id,
    'email', v_row.email,
    'role', v_row.role,
    'active', v_row.active
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_order_payload(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bootstrap_first_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_first_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_guest_order(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_guest_order(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_manual_crypto_payment(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_seller_inquiry(TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ============================================================================
-- SUPABASE STORAGE BUCKET & RLS POLICIES (Product Images & Crypto QR Codes)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  TRUE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = TRUE,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
CREATE POLICY "Public read product images"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Admins upload product images" ON storage.objects;
CREATE POLICY "Admins upload product images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());

DROP POLICY IF EXISTS "Admins update product images" ON storage.objects;
CREATE POLICY "Admins update product images"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());

DROP POLICY IF EXISTS "Admins delete product images" ON storage.objects;
CREATE POLICY "Admins delete product images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin());

-- Refresh PostgREST schema cache so API endpoints see newly created tables immediately
NOTIFY pgrst, 'reload schema';
