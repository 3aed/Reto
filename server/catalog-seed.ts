import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './config.ts';
import { isSupabaseConfigured } from './config.ts';
import { createServiceRoleSupabaseClient } from './supabase.ts';

export interface SeedCategory {
  slug: string;
  name: string;
  description: string;
}

export interface SeedSeller {
  username: string;
  email: string;
  location: string;
  specialty: string;
  response_time: string;
  phone: string;
  whatsapp: string;
  telegram: string;
  other_contact_url: string;
}

export interface SeedProduct {
  name: string;
  description: string;
  price_cents: number;
  category_slug: string;
  seller_username: string;
  condition: string;
  availability: string;
  stock_quantity: number;
  in_stock: boolean;
  is_digital: boolean;
  shipping_cost_cents: number;
  shipping_method: string;
  shipping_handling: string;
  shipping_from: string;
  return_policy: string;
  image_url: string;
  specs_json: Record<string, string>;
  custom_attributes_json: Record<string, string>;
  featured: boolean;
}

export const INITIAL_CATEGORIES: SeedCategory[] = [
  {
    slug: 'keyboards-input',
    name: 'Keyboards & Input Devices',
    description: 'Mechanical buckling-spring keyboards, optical trackballs, and classic desktop peripherals.',
  },
  {
    slug: 'displays-graphics',
    name: 'Monitors & Graphics Cards',
    description: 'Aperture-grille CRT displays, AGP/PCI 3D accelerators, and vintage workstation video hardware.',
  },
  {
    slug: 'portable-audio-gaming',
    name: 'Handhelds & Portable Audio',
    description: 'Classic handheld game consoles, personal cassette players, and portable electronics.',
  },
  {
    slug: 'cameras-pda',
    name: 'Digital Cameras & PDAs',
    description: 'Early floppy/memory-stick digital cameras, Palm organizers, and pocket computing gear.',
  },
  {
    slug: 'software-storage',
    name: 'Boxed Software & Storage Media',
    description: 'Complete retail PC software boxes, Zip cartridges, and archival 3.5-inch floppy disks.',
  },
];

export const INITIAL_SELLERS: SeedSeller[] = [
  {
    username: 'MidwestVintageTech',
    email: 'orders@midwestvintagetech.com',
    location: 'Chicago, IL',
    specialty: 'Mechanical Keyboards & IBM Peripherals',
    response_time: 'Within 12 hours',
    phone: '+1 312-555-0148',
    whatsapp: '+13125550148',
    telegram: '@midwestvintagetech',
    other_contact_url: '',
  },
  {
    username: 'CRTWorkshopChicago',
    email: 'desk@crtworkshop.com',
    location: 'Evanston, IL',
    specialty: 'CRT Displays & 3D Accelerators',
    response_time: 'Within 24 hours',
    phone: '+1 847-555-0192',
    whatsapp: '+18475550192',
    telegram: '@crtworkshop',
    other_contact_url: '',
  },
  {
    username: 'PixelVaultCollectibles',
    email: 'sales@pixelvaultcollectibles.com',
    location: 'Portland, OR',
    specialty: 'Handheld Consoles & Portable Audio',
    response_time: 'Within 6 hours',
    phone: '+1 503-555-0164',
    whatsapp: '+15035550164',
    telegram: '@pixelvaultpdx',
    other_contact_url: '',
  },
  {
    username: 'AnalogArchiveNY',
    email: 'hello@analogarchiveny.com',
    location: 'Brooklyn, NY',
    specialty: 'Early Digital Cameras & Pocket PDAs',
    response_time: 'Within 24 hours',
    phone: '+1 718-555-0137',
    whatsapp: '+17185550137',
    telegram: '@analogarchiveny',
    other_contact_url: '',
  },
  {
    username: 'SiliconAtticSupply',
    email: 'support@siliconatticsupply.com',
    location: 'Austin, TX',
    specialty: 'Boxed PC Software & Legacy Media',
    response_time: 'Within 12 hours',
    phone: '+1 512-555-0181',
    whatsapp: '+15125550181',
    telegram: '@siliconattic',
    other_contact_url: '',
  },
];

export const INITIAL_PRODUCTS: SeedProduct[] = [
  {
    name: 'IBM Model M Mechanical Keyboard (1993, PS/2)',
    description:
      'Original 1993 Lexmark-manufactured IBM Model M (Part No. 1391401) featuring crisp buckling-spring switches and two-piece dye-sublimated PBT keycaps. Fully cleaned inside and out, all 101 keys verified on a native PS/2 host, with original coiled SDL-to-PS/2 cable included.',
    price_cents: 14900,
    category_slug: 'keyboards-input',
    seller_username: 'MidwestVintageTech',
    condition: 'Refurbished - Clean',
    availability: 'In Stock (3 available)',
    stock_quantity: 3,
    in_stock: true,
    is_digital: false,
    shipping_cost_cents: 1450,
    shipping_method: 'UPS Ground Insured',
    shipping_handling: 'Ships within 1 business day',
    shipping_from: 'Chicago, IL',
    return_policy: '14-day return policy',
    image_url: 'assets/images/retro-keyboard.jpg',
    specs_json: {
      Brand: 'IBM / Lexmark',
      Model: '1391401 Model M',
      Switches: 'Buckling Spring',
      Interface: 'PS/2 (Detachable SDL)',
      Year: '1993',
    },
    custom_attributes_json: {
      Layout: 'US ANSI 101-Key',
      Color: 'Pearl White / Pebble Gray',
      Cable: 'Original Coiled SDL-to-PS/2',
    },
    featured: true,
  },
  {
    name: 'Sony Trinitron Multiscan 17" CRT Monitor',
    description:
      'Sharp 17-inch Sony Trinitron FD aperture-grille CRT display capable of crisp 1280x1024 resolution at 85Hz. Geometry, convergence, and phosphor brightness checked with calibration patterns; zero screen burn-in and clean anti-glare coating. Double-boxed with high-density foam for safe transit.',
    price_cents: 26500,
    category_slug: 'displays-graphics',
    seller_username: 'CRTWorkshopChicago',
    condition: 'Used - Calibrated',
    availability: 'In Stock (2 available)',
    stock_quantity: 2,
    in_stock: true,
    is_digital: false,
    shipping_cost_cents: 3900,
    shipping_method: 'Double-Boxed Freight Ground',
    shipping_handling: 'Ships within 2 business days',
    shipping_from: 'Evanston, IL',
    return_policy: '14-day return policy',
    image_url: 'assets/images/retro-crt-monitor.jpg',
    specs_json: {
      Brand: 'Sony',
      Series: 'Trinitron Multiscan',
      ScreenSize: '17 inch (16" viewable)',
      MaxResolution: '1600 x 1200',
      Input: '15-pin D-Sub VGA',
    },
    custom_attributes_json: {
      TubeType: 'FD Trinitron Aperture Grille',
      Color: 'Classic Beige',
      PowerCable: 'Included',
    },
    featured: true,
  },
  {
    name: '3dfx Voodoo3 3000 AGP 16MB Graphics Card',
    description:
      'Authentic 3dfx Voodoo3 3000 AGP 2x video card with 16MB SDRAM and TV-Out support. Ideal for Windows 98 and Glide-era 3D titles. Inspected for capacitor health, heatsink securely seated, and benchmarked across Direct3D and Glide sessions without artifacts.',
    price_cents: 18500,
    category_slug: 'displays-graphics',
    seller_username: 'CRTWorkshopChicago',
    condition: 'Used - Benchmarked',
    availability: 'In Stock (2 available)',
    stock_quantity: 2,
    in_stock: true,
    is_digital: false,
    shipping_cost_cents: 950,
    shipping_method: 'USPS Priority Anti-Static Box',
    shipping_handling: 'Ships within 1 business day',
    shipping_from: 'Evanston, IL',
    return_policy: '14-day return policy',
    image_url: 'assets/images/retro-gpu.jpg',
    specs_json: {
      Chipset: '3dfx Avenger (Voodoo3 3000)',
      Memory: '16MB 166MHz SDRAM',
      Bus: 'AGP 2x (3.3V)',
      Outputs: 'VGA + S-Video TV-Out',
      API: 'Glide, Direct3D, OpenGL',
    },
    custom_attributes_json: {
      Cooling: 'Factory Passive Aluminum Heatsink',
      Packaging: 'ESD Bag + Foam Box',
    },
    featured: true,
  },
  {
    name: 'Game Boy Color Atomic Purple Handheld Console',
    description:
      'Clean translucent Atomic Purple Game Boy Color (CGB-001) with original battery cover intact, crisp speaker output, and responsive D-pad and A/B buttons. Cartridge pins and power switch cleaned for instant boot on first try. Runs on two AA batteries.',
    price_cents: 9450,
    category_slug: 'portable-audio-gaming',
    seller_username: 'PixelVaultCollectibles',
    condition: 'Used - Very Good',
    availability: 'In Stock (4 available)',
    stock_quantity: 4,
    in_stock: true,
    is_digital: false,
    shipping_cost_cents: 750,
    shipping_method: 'USPS Priority Mail',
    shipping_handling: 'Ships within 1 business day',
    shipping_from: 'Portland, OR',
    return_policy: '14-day return policy',
    image_url: 'assets/images/retro-handheld.jpg',
    specs_json: {
      Brand: 'Nintendo',
      Model: 'CGB-001 Game Boy Color',
      Display: 'Reflective TFT Color LCD',
      Power: '2x AA Batteries',
      Audio: 'Built-in Speaker + 3.5mm Jack',
    },
    custom_attributes_json: {
      Color: 'Atomic Purple (Translucent)',
      Region: 'Region-Free',
      BatteryCover: 'Original Included',
    },
    featured: true,
  },
  {
    name: 'Sony Walkman WM-FX290 Stereo Cassette Player',
    description:
      'Classic late-90s Sony Walkman WM-FX290 featuring digital AM/FM tuner, Mega Bass boost, and freshly replaced drive belt for steady tape speed and minimal wow/flutter. Head and pinch roller cleaned; includes belt clip.',
    price_cents: 6800,
    category_slug: 'portable-audio-gaming',
    seller_username: 'PixelVaultCollectibles',
    condition: 'Serviced - New Belt',
    availability: 'In Stock (5 available)',
    stock_quantity: 5,
    in_stock: true,
    is_digital: false,
    shipping_cost_cents: 650,
    shipping_method: 'USPS Ground Advantage',
    shipping_handling: 'Ships within 1 business day',
    shipping_from: 'Portland, OR',
    return_policy: '14-day return policy',
    image_url: 'assets/images/retro-walkman.jpg',
    specs_json: {
      Brand: 'Sony',
      Model: 'WM-FX290',
      Media: 'Standard Compact Cassette',
      Tuner: 'Digital AM/FM (40 Presets)',
      Power: '1x AA Battery',
    },
    custom_attributes_json: {
      Feature: 'AVLS & Mega Bass',
      Color: 'Metallic Silver / Charcoal',
      BeltClip: 'Included',
    },
    featured: false,
  },
  {
    name: 'Sony Mavica MVC-FD73 Floppy Digital Camera',
    description:
      'Iconic Sony Digital Mavica MVC-FD73 that saves JPEG stills directly onto standard 3.5-inch floppy disks. Features 10x optical zoom lens, bright 2.5-inch rear LCD, and clean floppy drive mechanism. Includes compatible InfoLithium battery pack, charger, and 3 blank floppies.',
    price_cents: 7900,
    category_slug: 'cameras-pda',
    seller_username: 'AnalogArchiveNY',
    condition: 'Used - Working',
    availability: 'In Stock (3 available)',
    stock_quantity: 3,
    in_stock: true,
    is_digital: false,
    shipping_cost_cents: 850,
    shipping_method: 'USPS Priority Mail',
    shipping_handling: 'Ships within 2 business days',
    shipping_from: 'Brooklyn, NY',
    return_policy: '14-day return policy',
    image_url: 'assets/images/retro-camera.jpg',
    specs_json: {
      Brand: 'Sony',
      Model: 'Mavica MVC-FD73',
      Storage: '3.5" 1.44MB Floppy Disk',
      Zoom: '10x Optical Zoom',
      Resolution: '640 x 480 VGA JPEG',
    },
    custom_attributes_json: {
      Battery: 'NP-F330 Replacement + Charger',
      Extras: '3 Blank 3.5" Floppy Disks',
    },
    featured: true,
  },
  {
    name: 'Palm Vx Connected Organizer PDA with HotSync Cradle',
    description:
      'Ultra-slim anodized aluminum Palm Vx running Palm OS 3.5 with 8MB RAM and crisp backlit monochrome touchscreen. Digitizer accurately calibrated across the Graffiti area. Includes original weighted serial HotSync docking cradle, stylus, and AC power adapter.',
    price_cents: 6250,
    category_slug: 'cameras-pda',
    seller_username: 'AnalogArchiveNY',
    condition: 'Used - Good',
    availability: 'In Stock (4 available)',
    stock_quantity: 4,
    in_stock: true,
    is_digital: false,
    shipping_cost_cents: 600,
    shipping_method: 'USPS Ground Advantage',
    shipping_handling: 'Ships within 2 business days',
    shipping_from: 'Brooklyn, NY',
    return_policy: '14-day return policy',
    image_url: 'assets/images/retro-pda.jpg',
    specs_json: {
      Brand: 'Palm Computing',
      Model: 'Palm Vx',
      OS: 'Palm OS 3.5',
      Memory: '8MB RAM',
      SyncInterface: 'RS-232 Serial Cradle + IR',
    },
    custom_attributes_json: {
      Chassis: 'Brushed Anodized Aluminum',
      Accessories: 'Stylus, Cradle, Power Adapter',
    },
    featured: false,
  },
  {
    name: 'Logitech TrackMan Marble Wheel PS/2 Trackball',
    description:
      'Ergonomic thumb-operated Logitech TrackMan Marble Wheel trackball featuring red speckled Marble optical sensing for maintenance-free precision. Smooth stainless steel bearing points, crisp left/right clicks, and clean scroll wheel. Native PS/2 plug.',
    price_cents: 4400,
    category_slug: 'keyboards-input',
    seller_username: 'MidwestVintageTech',
    condition: 'Used - Very Good',
    availability: 'In Stock (6 available)',
    stock_quantity: 6,
    in_stock: true,
    is_digital: false,
    shipping_cost_cents: 650,
    shipping_method: 'USPS Ground Advantage',
    shipping_handling: 'Ships within 1 business day',
    shipping_from: 'Chicago, IL',
    return_policy: '14-day return policy',
    image_url: 'assets/images/retro-trackball.jpg',
    specs_json: {
      Brand: 'Logitech',
      Model: 'TrackMan Marble Wheel (T-BB13)',
      Sensor: 'Optical Marble Tracking',
      Interface: 'PS/2',
      Buttons: '2 + Scroll Wheel',
    },
    custom_attributes_json: {
      Orientation: 'Right-Handed Ergonomic',
      BallColor: 'Red Speckled',
    },
    featured: false,
  },
  {
    name: 'Windows 98 Second Edition Complete Retail Box',
    description:
      'Complete big-box retail edition of Microsoft Windows 98 Second Edition. Includes original holographic installation CD-ROM, 3.5-inch boot startup floppy disk, Getting Started manual with Certificate of Authenticity, and inner cardboard inserts in clean shelf condition.',
    price_cents: 11500,
    category_slug: 'software-storage',
    seller_username: 'SiliconAtticSupply',
    condition: 'Complete in Box',
    availability: 'In Stock (2 available)',
    stock_quantity: 2,
    in_stock: true,
    is_digital: false,
    shipping_cost_cents: 800,
    shipping_method: 'USPS Priority Mail',
    shipping_handling: 'Ships within 1 business day',
    shipping_from: 'Austin, TX',
    return_policy: '14-day return policy',
    image_url: 'assets/images/retro-software-box.jpg',
    specs_json: {
      Publisher: 'Microsoft',
      Edition: 'Windows 98 Second Edition',
      Media: 'CD-ROM + 3.5" Boot Floppy',
      Architecture: 'x86 (16/32-bit)',
      Language: 'English',
    },
    custom_attributes_json: {
      Contents: 'Box, CD, Boot Floppy, Manual',
      BoxGrade: 'Clean Corners, Light Shelf Wear',
    },
    featured: true,
  },
  {
    name: 'Iomega Zip 100MB Disk 10-Pack + 3.5" Floppy Bundle',
    description:
      'Archive-ready bundle containing ten IBM-formatted Iomega Zip 100MB cartridges in protective jewel cases plus a box of twenty high-density 1.44MB 3.5-inch floppy disks. Every disk surface verified clean with zero bad sectors and fresh adhesive labels included.',
    price_cents: 3800,
    category_slug: 'software-storage',
    seller_username: 'SiliconAtticSupply',
    condition: 'Open Box - Verified',
    availability: 'In Stock (8 available)',
    stock_quantity: 8,
    in_stock: true,
    is_digital: false,
    shipping_cost_cents: 0,
    shipping_method: 'Free Standard Ground Shipping',
    shipping_handling: 'Ships within 1 business day',
    shipping_from: 'Austin, TX',
    return_policy: '14-day return policy',
    image_url: 'assets/images/retro-storage-media.jpg',
    specs_json: {
      Brand: 'Iomega / Verbatim',
      ZipCapacity: '100MB per Cartridge (x10)',
      FloppyCapacity: '1.44MB 2HD (x20)',
      Format: 'IBM / PC Formatted',
    },
    custom_attributes_json: {
      Cases: '10 Slim Jewel Cases Included',
      Labels: 'Blank Label Sheet Included',
    },
    featured: false,
  },
];

export interface SeedSummary {
  categoriesInserted: number;
  sellersInserted: number;
  productsInserted: number;
}

/**
 * Idempotently populates categories, sellers, and products into Supabase using
 * the provided Supabase client (either authenticated admin JWT or service role).
 */
export async function seedCatalogWithClient(supabase: SupabaseClient): Promise<SeedSummary> {
  // 1. Upsert categories by slug
  const { data: existingCats } = await supabase.from('categories').select('id, slug');
  const catMap = new Map<string, number>();
  for (const row of (existingCats || []) as Array<{ id: number; slug: string }>) {
    catMap.set(String(row.slug), Number(row.id));
  }

  let categoriesInserted = 0;
  for (const cat of INITIAL_CATEGORIES) {
    if (catMap.has(cat.slug)) continue;
    const { data, error } = await supabase
      .from('categories')
      .insert(cat)
      .select('id, slug')
      .maybeSingle();
    if (!error && data) {
      catMap.set(String(data.slug), Number(data.id));
      categoriesInserted += 1;
    }
  }

  // 2. Upsert sellers by username
  const { data: existingSellers } = await supabase.from('sellers').select('id, username');
  const sellerMap = new Map<string, number>();
  for (const row of (existingSellers || []) as Array<{ id: number; username: string }>) {
    sellerMap.set(String(row.username), Number(row.id));
  }

  let sellersInserted = 0;
  for (const seller of INITIAL_SELLERS) {
    if (sellerMap.has(seller.username)) continue;
    const { data, error } = await supabase
      .from('sellers')
      .insert({ ...seller, active: true })
      .select('id, username')
      .maybeSingle();
    if (!error && data) {
      sellerMap.set(String(data.username), Number(data.id));
      sellersInserted += 1;
    }
  }

  // 3. Insert products that do not already exist by exact name
  const { data: existingProds } = await supabase.from('products').select('name');
  const existingNames = new Set<string>(
    ((existingProds || []) as Array<{ name: string }>).map((p) => String(p.name).toLowerCase())
  );

  let productsInserted = 0;
  for (const prod of INITIAL_PRODUCTS) {
    if (existingNames.has(prod.name.toLowerCase())) continue;
    const categoryId = catMap.get(prod.category_slug);
    const sellerId = sellerMap.get(prod.seller_username);
    if (!categoryId || !sellerId) continue;

    const { error } = await supabase.from('products').insert({
      name: prod.name,
      description: prod.description,
      price_cents: prod.price_cents,
      category_id: categoryId,
      seller_id: sellerId,
      condition: prod.condition,
      availability: prod.availability,
      stock_quantity: prod.stock_quantity,
      in_stock: prod.in_stock,
      is_digital: prod.is_digital,
      shipping_cost_cents: prod.shipping_cost_cents,
      shipping_method: prod.shipping_method,
      shipping_handling: prod.shipping_handling,
      shipping_from: prod.shipping_from,
      return_policy: prod.return_policy,
      image_url: prod.image_url,
      gallery_json: [{ src: prod.image_url, caption: prod.name }],
      specs_json: prod.specs_json,
      custom_attributes_json: prod.custom_attributes_json,
      seller_contact_json: {},
      featured: prod.featured,
    });
    if (!error) {
      productsInserted += 1;
      existingNames.add(prod.name.toLowerCase());
    }
  }

  return { categoriesInserted, sellersInserted, productsInserted };
}

/**
 * Runs once on server startup when SUPABASE_SERVICE_ROLE_KEY is configured and
 * the catalog has never been seeded yet (tracks CATALOG_INITIAL_SEEDED in audit_logs
 * so products deleted later by the admin are never re-created automatically).
 */
export async function ensureInitialCatalogSeed(cfg: AppConfig): Promise<void> {
  if (!isSupabaseConfigured(cfg)) return;
  const serviceClient = createServiceRoleSupabaseClient(cfg);
  if (!serviceClient) return;

  try {
    const [{ count: prodCount }, { count: seedLogCount }] = await Promise.all([
      serviceClient.from('products').select('id', { count: 'exact', head: true }),
      serviceClient
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .eq('action', 'CATALOG_INITIAL_SEEDED'),
    ]);

    if ((prodCount || 0) > 0 || (seedLogCount || 0) > 0) {
      return;
    }

    const summary = await seedCatalogWithClient(serviceClient);
    await serviceClient.from('audit_logs').insert({
      admin_user_id: null,
      admin_email: 'system',
      action: 'CATALOG_INITIAL_SEEDED',
      target_type: 'catalog',
      target_id: String(summary.productsInserted),
      details_json: summary,
      ip_address: '127.0.0.1',
    });

    console.log(
      `[RetroMarket] Initial catalog populated (${summary.categoriesInserted} categories, ${summary.sellersInserted} sellers, ${summary.productsInserted} products).`
    );
  } catch (err) {
    console.warn(
      '[RetroMarket] Startup catalog seed skipped:',
      err instanceof Error ? err.message : 'unknown'
    );
  }
}

/**
 * Formats the starter catalog in the exact public API shape.
 * Used ONLY when Supabase tables have not been initialized yet so the storefront
 * is never blank before supabase/schema.sql & supabase/seed.sql are executed.
 */
export function buildStarterCatalogSnapshot() {
  const catBySlug = new Map<
    string,
    { id: number; slug: string; name: string; description: string; productCount: number }
  >();
  const categories = INITIAL_CATEGORIES.map((c, idx) => {
    const entry = {
      id: idx + 1,
      slug: c.slug,
      name: c.name,
      description: c.description,
      productCount: 0,
    };
    catBySlug.set(c.slug, entry);
    return entry;
  });

  const sellerByUsername = new Map<
    string,
    {
      id: number;
      username: string;
      email: string;
      location: string;
      specialty: string;
      responseTime: string;
      phone: string;
      whatsapp: string;
      telegram: string;
      otherContactUrl: string;
      active: boolean;
      productCount: number;
    }
  >();
  const sellers = INITIAL_SELLERS.map((s, idx) => {
    const entry = {
      id: idx + 1,
      username: s.username,
      email: s.email,
      location: s.location,
      specialty: s.specialty,
      responseTime: s.response_time,
      phone: s.phone,
      whatsapp: s.whatsapp,
      telegram: s.telegram,
      otherContactUrl: s.other_contact_url,
      active: true,
      productCount: 0,
    };
    sellerByUsername.set(s.username, entry);
    return entry;
  });

  const today = new Date().toISOString().slice(0, 10);
  const products = INITIAL_PRODUCTS.map((p, idx) => {
    const cat = catBySlug.get(p.category_slug)!;
    const sel = sellerByUsername.get(p.seller_username)!;
    cat.productCount += 1;
    sel.productCount += 1;
    const waDigits = sel.whatsapp.replace(/\D/g, '');
    const tgHandle = sel.telegram.replace(/^@+/, '');

    return {
      id: idx + 1,
      name: p.name,
      description: p.description,
      price: Number((p.price_cents / 100).toFixed(2)),
      priceCents: p.price_cents,
      category: cat.slug,
      categoryId: cat.id,
      categoryName: cat.name,
      seller: sel.username,
      sellerId: sel.id,
      condition: p.condition,
      availability: p.availability,
      stockQuantity: p.stock_quantity,
      inStock: p.in_stock && p.stock_quantity > 0,
      isDigital: p.is_digital,
      featured: p.featured,
      image: p.image_url,
      images: [{ src: p.image_url, caption: p.name }],
      specs: p.specs_json,
      customAttributes: p.custom_attributes_json,
      sellerContact: {
        contactName: sel.username,
        email: sel.email,
        phone: sel.phone,
        whatsapp: sel.whatsapp,
        whatsappUrl: waDigits ? `https://wa.me/${waDigits}` : '',
        telegram: sel.telegram,
        telegramUrl: tgHandle ? `https://t.me/${tgHandle}` : '',
        otherLabel: '',
        otherUrl: sel.otherContactUrl,
        notes: '',
      },
      shippingCostCents: p.shipping_cost_cents,
      shipping: {
        method: p.shipping_method,
        cost: p.shipping_cost_cents === 0 ? 'Free ($0.00)' : `$${(p.shipping_cost_cents / 100).toFixed(2)}`,
        costAmount: Number((p.shipping_cost_cents / 100).toFixed(2)),
        handling: p.shipping_handling,
        shipsFrom: p.shipping_from,
        returns: p.return_policy,
      },
      dateAdded: today,
      createdAt: new Date().toISOString(),
    };
  });

  const publicSellers = sellers.map((s) => {
    const tgHandle = s.telegram.replace(/^@+/, '');
    return {
      id: s.id,
      username: s.username,
      location: s.location,
      specialty: s.specialty,
      responseTime: s.responseTime,
      telegram: s.telegram,
      telegramUrl: tgHandle ? `https://t.me/${tgHandle}` : '',
      active: s.active,
      productCount: s.productCount,
    };
  });

  return { categories, sellers: publicSellers, products };
}

