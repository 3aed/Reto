-- ============================================================================
-- RetroMarket — Initial Catalog Population SQL (Supabase SQL Editor)
-- ============================================================================
-- Inserts 5 categories, 5 sellers, and 10 vintage marketplace products as real
-- database rows that administrators can edit or delete anytime in the Admin Panel.
-- Safe to run multiple times (idempotent).
-- ============================================================================

INSERT INTO public.categories (slug, name, description)
VALUES
  ('keyboards-input', 'Keyboards & Input Devices', 'Mechanical buckling-spring keyboards, optical trackballs, and classic desktop peripherals.'),
  ('displays-graphics', 'Monitors & Graphics Cards', 'Aperture-grille CRT displays, AGP/PCI 3D accelerators, and vintage workstation video hardware.'),
  ('portable-audio-gaming', 'Handhelds & Portable Audio', 'Classic handheld game consoles, personal cassette players, and portable electronics.'),
  ('cameras-pda', 'Digital Cameras & PDAs', 'Early floppy/memory-stick digital cameras, Palm organizers, and pocket computing gear.'),
  ('software-storage', 'Boxed Software & Storage Media', 'Complete retail PC software boxes, Zip cartridges, and archival 3.5-inch floppy disks.')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.sellers (username, email, location, specialty, response_time, phone, whatsapp, telegram, other_contact_url, active)
VALUES
  ('MidwestVintageTech', 'orders@midwestvintagetech.com', 'Chicago, IL', 'Mechanical Keyboards & IBM Peripherals', 'Within 12 hours', '+1 312-555-0148', '+13125550148', '@midwestvintagetech', '', TRUE),
  ('CRTWorkshopChicago', 'desk@crtworkshop.com', 'Evanston, IL', 'CRT Displays & 3D Accelerators', 'Within 24 hours', '+1 847-555-0192', '+18475550192', '@crtworkshop', '', TRUE),
  ('PixelVaultCollectibles', 'sales@pixelvaultcollectibles.com', 'Portland, OR', 'Handheld Consoles & Portable Audio', 'Within 6 hours', '+1 503-555-0164', '+15035550164', '@pixelvaultpdx', '', TRUE),
  ('AnalogArchiveNY', 'hello@analogarchiveny.com', 'Brooklyn, NY', 'Early Digital Cameras & Pocket PDAs', 'Within 24 hours', '+1 718-555-0137', '+17185550137', '@analogarchiveny', '', TRUE),
  ('SiliconAtticSupply', 'support@siliconatticsupply.com', 'Austin, TX', 'Boxed PC Software & Legacy Media', 'Within 12 hours', '+1 512-555-0181', '+15125550181', '@siliconattic', '', TRUE)
ON CONFLICT (username) DO NOTHING;

DO $$
DECLARE
  v_cat_kb BIGINT;
  v_cat_disp BIGINT;
  v_cat_port BIGINT;
  v_cat_cam BIGINT;
  v_cat_soft BIGINT;
  v_sel_midwest BIGINT;
  v_sel_crt BIGINT;
  v_sel_pixel BIGINT;
  v_sel_analog BIGINT;
  v_sel_silicon BIGINT;
BEGIN
  SELECT id INTO v_cat_kb FROM public.categories WHERE slug = 'keyboards-input';
  SELECT id INTO v_cat_disp FROM public.categories WHERE slug = 'displays-graphics';
  SELECT id INTO v_cat_port FROM public.categories WHERE slug = 'portable-audio-gaming';
  SELECT id INTO v_cat_cam FROM public.categories WHERE slug = 'cameras-pda';
  SELECT id INTO v_cat_soft FROM public.categories WHERE slug = 'software-storage';

  SELECT id INTO v_sel_midwest FROM public.sellers WHERE username = 'MidwestVintageTech';
  SELECT id INTO v_sel_crt FROM public.sellers WHERE username = 'CRTWorkshopChicago';
  SELECT id INTO v_sel_pixel FROM public.sellers WHERE username = 'PixelVaultCollectibles';
  SELECT id INTO v_sel_analog FROM public.sellers WHERE username = 'AnalogArchiveNY';
  SELECT id INTO v_sel_silicon FROM public.sellers WHERE username = 'SiliconAtticSupply';

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'IBM Model M Mechanical Keyboard (1993, PS/2)') THEN
    INSERT INTO public.products (
      name, description, price_cents, category_id, seller_id, condition, availability,
      stock_quantity, in_stock, is_digital, shipping_cost_cents, shipping_method,
      shipping_handling, shipping_from, return_policy, image_url, gallery_json,
      specs_json, custom_attributes_json, seller_contact_json, featured
    ) VALUES (
      'IBM Model M Mechanical Keyboard (1993, PS/2)',
      'Original 1993 Lexmark-manufactured IBM Model M (Part No. 1391401) featuring crisp buckling-spring switches and two-piece dye-sublimated PBT keycaps. Fully cleaned inside and out, all 101 keys verified on a native PS/2 host, with original coiled SDL-to-PS/2 cable included.',
      14900, v_cat_kb, v_sel_midwest, 'Refurbished - Clean', 'In Stock (3 available)',
      3, TRUE, FALSE, 1450, 'UPS Ground Insured', 'Ships within 1 business day', 'Chicago, IL', '14-day return policy',
      'assets/images/retro-keyboard.jpg',
      '[{"src":"assets/images/retro-keyboard.jpg","caption":"IBM Model M Mechanical Keyboard (1993, PS/2)"}]'::jsonb,
      '{"Brand":"IBM / Lexmark","Model":"1391401 Model M","Switches":"Buckling Spring","Interface":"PS/2 (Detachable SDL)","Year":"1993"}'::jsonb,
      '{"Layout":"US ANSI 101-Key","Color":"Pearl White / Pebble Gray","Cable":"Original Coiled SDL-to-PS/2"}'::jsonb,
      '{}'::jsonb, TRUE
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'Sony Trinitron Multiscan 17" CRT Monitor') THEN
    INSERT INTO public.products (
      name, description, price_cents, category_id, seller_id, condition, availability,
      stock_quantity, in_stock, is_digital, shipping_cost_cents, shipping_method,
      shipping_handling, shipping_from, return_policy, image_url, gallery_json,
      specs_json, custom_attributes_json, seller_contact_json, featured
    ) VALUES (
      'Sony Trinitron Multiscan 17" CRT Monitor',
      'Sharp 17-inch Sony Trinitron FD aperture-grille CRT display capable of crisp 1280x1024 resolution at 85Hz. Geometry, convergence, and phosphor brightness checked with calibration patterns; zero screen burn-in and clean anti-glare coating. Double-boxed with high-density foam for safe transit.',
      26500, v_cat_disp, v_sel_crt, 'Used - Calibrated', 'In Stock (2 available)',
      2, TRUE, FALSE, 3900, 'Double-Boxed Freight Ground', 'Ships within 2 business days', 'Evanston, IL', '14-day return policy',
      'assets/images/retro-crt-monitor.jpg',
      '[{"src":"assets/images/retro-crt-monitor.jpg","caption":"Sony Trinitron Multiscan 17\" CRT Monitor"}]'::jsonb,
      '{"Brand":"Sony","Series":"Trinitron Multiscan","ScreenSize":"17 inch (16\" viewable)","MaxResolution":"1600 x 1200","Input":"15-pin D-Sub VGA"}'::jsonb,
      '{"TubeType":"FD Trinitron Aperture Grille","Color":"Classic Beige","PowerCable":"Included"}'::jsonb,
      '{}'::jsonb, TRUE
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE name = '3dfx Voodoo3 3000 AGP 16MB Graphics Card') THEN
    INSERT INTO public.products (
      name, description, price_cents, category_id, seller_id, condition, availability,
      stock_quantity, in_stock, is_digital, shipping_cost_cents, shipping_method,
      shipping_handling, shipping_from, return_policy, image_url, gallery_json,
      specs_json, custom_attributes_json, seller_contact_json, featured
    ) VALUES (
      '3dfx Voodoo3 3000 AGP 16MB Graphics Card',
      'Authentic 3dfx Voodoo3 3000 AGP 2x video card with 16MB SDRAM and TV-Out support. Ideal for Windows 98 and Glide-era 3D titles. Inspected for capacitor health, heatsink securely seated, and benchmarked across Direct3D and Glide sessions without artifacts.',
      18500, v_cat_disp, v_sel_crt, 'Used - Benchmarked', 'In Stock (2 available)',
      2, TRUE, FALSE, 950, 'USPS Priority Anti-Static Box', 'Ships within 1 business day', 'Evanston, IL', '14-day return policy',
      'assets/images/retro-gpu.jpg',
      '[{"src":"assets/images/retro-gpu.jpg","caption":"3dfx Voodoo3 3000 AGP 16MB Graphics Card"}]'::jsonb,
      '{"Chipset":"3dfx Avenger (Voodoo3 3000)","Memory":"16MB 166MHz SDRAM","Bus":"AGP 2x (3.3V)","Outputs":"VGA + S-Video TV-Out","API":"Glide, Direct3D, OpenGL"}'::jsonb,
      '{"Cooling":"Factory Passive Aluminum Heatsink","Packaging":"ESD Bag + Foam Box"}'::jsonb,
      '{}'::jsonb, TRUE
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'Game Boy Color Atomic Purple Handheld Console') THEN
    INSERT INTO public.products (
      name, description, price_cents, category_id, seller_id, condition, availability,
      stock_quantity, in_stock, is_digital, shipping_cost_cents, shipping_method,
      shipping_handling, shipping_from, return_policy, image_url, gallery_json,
      specs_json, custom_attributes_json, seller_contact_json, featured
    ) VALUES (
      'Game Boy Color Atomic Purple Handheld Console',
      'Clean translucent Atomic Purple Game Boy Color (CGB-001) with original battery cover intact, crisp speaker output, and responsive D-pad and A/B buttons. Cartridge pins and power switch cleaned for instant boot on first try. Runs on two AA batteries.',
      9450, v_cat_port, v_sel_pixel, 'Used - Very Good', 'In Stock (4 available)',
      4, TRUE, FALSE, 750, 'USPS Priority Mail', 'Ships within 1 business day', 'Portland, OR', '14-day return policy',
      'assets/images/retro-handheld.jpg',
      '[{"src":"assets/images/retro-handheld.jpg","caption":"Game Boy Color Atomic Purple Handheld Console"}]'::jsonb,
      '{"Brand":"Nintendo","Model":"CGB-001 Game Boy Color","Display":"Reflective TFT Color LCD","Power":"2x AA Batteries","Audio":"Built-in Speaker + 3.5mm Jack"}'::jsonb,
      '{"Color":"Atomic Purple (Translucent)","Region":"Region-Free","BatteryCover":"Original Included"}'::jsonb,
      '{}'::jsonb, TRUE
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'Sony Walkman WM-FX290 Stereo Cassette Player') THEN
    INSERT INTO public.products (
      name, description, price_cents, category_id, seller_id, condition, availability,
      stock_quantity, in_stock, is_digital, shipping_cost_cents, shipping_method,
      shipping_handling, shipping_from, return_policy, image_url, gallery_json,
      specs_json, custom_attributes_json, seller_contact_json, featured
    ) VALUES (
      'Sony Walkman WM-FX290 Stereo Cassette Player',
      'Classic late-90s Sony Walkman WM-FX290 featuring digital AM/FM tuner, Mega Bass boost, and freshly replaced drive belt for steady tape speed and minimal wow/flutter. Head and pinch roller cleaned; includes belt clip.',
      6800, v_cat_port, v_sel_pixel, 'Serviced - New Belt', 'In Stock (5 available)',
      5, TRUE, FALSE, 650, 'USPS Ground Advantage', 'Ships within 1 business day', 'Portland, OR', '14-day return policy',
      'assets/images/retro-walkman.jpg',
      '[{"src":"assets/images/retro-walkman.jpg","caption":"Sony Walkman WM-FX290 Stereo Cassette Player"}]'::jsonb,
      '{"Brand":"Sony","Model":"WM-FX290","Media":"Standard Compact Cassette","Tuner":"Digital AM/FM (40 Presets)","Power":"1x AA Battery"}'::jsonb,
      '{"Feature":"AVLS & Mega Bass","Color":"Metallic Silver / Charcoal","BeltClip":"Included"}'::jsonb,
      '{}'::jsonb, FALSE
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'Sony Mavica MVC-FD73 Floppy Digital Camera') THEN
    INSERT INTO public.products (
      name, description, price_cents, category_id, seller_id, condition, availability,
      stock_quantity, in_stock, is_digital, shipping_cost_cents, shipping_method,
      shipping_handling, shipping_from, return_policy, image_url, gallery_json,
      specs_json, custom_attributes_json, seller_contact_json, featured
    ) VALUES (
      'Sony Mavica MVC-FD73 Floppy Digital Camera',
      'Iconic Sony Digital Mavica MVC-FD73 that saves JPEG stills directly onto standard 3.5-inch floppy disks. Features 10x optical zoom lens, bright 2.5-inch rear LCD, and clean floppy drive mechanism. Includes compatible InfoLithium battery pack, charger, and 3 blank floppies.',
      7900, v_cat_cam, v_sel_analog, 'Used - Working', 'In Stock (3 available)',
      3, TRUE, FALSE, 850, 'USPS Priority Mail', 'Ships within 2 business days', 'Brooklyn, NY', '14-day return policy',
      'assets/images/retro-camera.jpg',
      '[{"src":"assets/images/retro-camera.jpg","caption":"Sony Mavica MVC-FD73 Floppy Digital Camera"}]'::jsonb,
      '{"Brand":"Sony","Model":"Mavica MVC-FD73","Storage":"3.5\" 1.44MB Floppy Disk","Zoom":"10x Optical Zoom","Resolution":"640 x 480 VGA JPEG"}'::jsonb,
      '{"Battery":"NP-F330 Replacement + Charger","Extras":"3 Blank 3.5\" Floppy Disks"}'::jsonb,
      '{}'::jsonb, TRUE
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'Palm Vx Connected Organizer PDA with HotSync Cradle') THEN
    INSERT INTO public.products (
      name, description, price_cents, category_id, seller_id, condition, availability,
      stock_quantity, in_stock, is_digital, shipping_cost_cents, shipping_method,
      shipping_handling, shipping_from, return_policy, image_url, gallery_json,
      specs_json, custom_attributes_json, seller_contact_json, featured
    ) VALUES (
      'Palm Vx Connected Organizer PDA with HotSync Cradle',
      'Ultra-slim anodized aluminum Palm Vx running Palm OS 3.5 with 8MB RAM and crisp backlit monochrome touchscreen. Digitizer accurately calibrated across the Graffiti area. Includes original weighted serial HotSync docking cradle, stylus, and AC power adapter.',
      6250, v_cat_cam, v_sel_analog, 'Used - Good', 'In Stock (4 available)',
      4, TRUE, FALSE, 600, 'USPS Ground Advantage', 'Ships within 2 business days', 'Brooklyn, NY', '14-day return policy',
      'assets/images/retro-pda.jpg',
      '[{"src":"assets/images/retro-pda.jpg","caption":"Palm Vx Connected Organizer PDA with HotSync Cradle"}]'::jsonb,
      '{"Brand":"Palm Computing","Model":"Palm Vx","OS":"Palm OS 3.5","Memory":"8MB RAM","SyncInterface":"RS-232 Serial Cradle + IR"}'::jsonb,
      '{"Chassis":"Brushed Anodized Aluminum","Accessories":"Stylus, Cradle, Power Adapter"}'::jsonb,
      '{}'::jsonb, FALSE
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'Logitech TrackMan Marble Wheel PS/2 Trackball') THEN
    INSERT INTO public.products (
      name, description, price_cents, category_id, seller_id, condition, availability,
      stock_quantity, in_stock, is_digital, shipping_cost_cents, shipping_method,
      shipping_handling, shipping_from, return_policy, image_url, gallery_json,
      specs_json, custom_attributes_json, seller_contact_json, featured
    ) VALUES (
      'Logitech TrackMan Marble Wheel PS/2 Trackball',
      'Ergonomic thumb-operated Logitech TrackMan Marble Wheel trackball featuring red speckled Marble optical sensing for maintenance-free precision. Smooth stainless steel bearing points, crisp left/right clicks, and clean scroll wheel. Native PS/2 plug.',
      4400, v_cat_kb, v_sel_midwest, 'Used - Very Good', 'In Stock (6 available)',
      6, TRUE, FALSE, 650, 'USPS Ground Advantage', 'Ships within 1 business day', 'Chicago, IL', '14-day return policy',
      'assets/images/retro-trackball.jpg',
      '[{"src":"assets/images/retro-trackball.jpg","caption":"Logitech TrackMan Marble Wheel PS/2 Trackball"}]'::jsonb,
      '{"Brand":"Logitech","Model":"TrackMan Marble Wheel (T-BB13)","Sensor":"Optical Marble Tracking","Interface":"PS/2","Buttons":"2 + Scroll Wheel"}'::jsonb,
      '{"Orientation":"Right-Handed Ergonomic","BallColor":"Red Speckled"}'::jsonb,
      '{}'::jsonb, FALSE
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'Windows 98 Second Edition Complete Retail Box') THEN
    INSERT INTO public.products (
      name, description, price_cents, category_id, seller_id, condition, availability,
      stock_quantity, in_stock, is_digital, shipping_cost_cents, shipping_method,
      shipping_handling, shipping_from, return_policy, image_url, gallery_json,
      specs_json, custom_attributes_json, seller_contact_json, featured
    ) VALUES (
      'Windows 98 Second Edition Complete Retail Box',
      'Complete big-box retail edition of Microsoft Windows 98 Second Edition. Includes original holographic installation CD-ROM, 3.5-inch boot startup floppy disk, Getting Started manual with Certificate of Authenticity, and inner cardboard inserts in clean shelf condition.',
      11500, v_cat_soft, v_sel_silicon, 'Complete in Box', 'In Stock (2 available)',
      2, TRUE, FALSE, 800, 'USPS Priority Mail', 'Ships within 1 business day', 'Austin, TX', '14-day return policy',
      'assets/images/retro-software-box.jpg',
      '[{"src":"assets/images/retro-software-box.jpg","caption":"Windows 98 Second Edition Complete Retail Box"}]'::jsonb,
      '{"Publisher":"Microsoft","Edition":"Windows 98 Second Edition","Media":"CD-ROM + 3.5\" Boot Floppy","Architecture":"x86 (16/32-bit)","Language":"English"}'::jsonb,
      '{"Contents":"Box, CD, Boot Floppy, Manual","BoxGrade":"Clean Corners, Light Shelf Wear"}'::jsonb,
      '{}'::jsonb, TRUE
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE name = 'Iomega Zip 100MB Disk 10-Pack + 3.5" Floppy Bundle') THEN
    INSERT INTO public.products (
      name, description, price_cents, category_id, seller_id, condition, availability,
      stock_quantity, in_stock, is_digital, shipping_cost_cents, shipping_method,
      shipping_handling, shipping_from, return_policy, image_url, gallery_json,
      specs_json, custom_attributes_json, seller_contact_json, featured
    ) VALUES (
      'Iomega Zip 100MB Disk 10-Pack + 3.5" Floppy Bundle',
      'Archive-ready bundle containing ten IBM-formatted Iomega Zip 100MB cartridges in protective jewel cases plus a box of twenty high-density 1.44MB 3.5-inch floppy disks. Every disk surface verified clean with zero bad sectors and fresh adhesive labels included.',
      3800, v_cat_soft, v_sel_silicon, 'Open Box - Verified', 'In Stock (8 available)',
      8, TRUE, FALSE, 0, 'Free Standard Ground Shipping', 'Ships within 1 business day', 'Austin, TX', '14-day return policy',
      'assets/images/retro-storage-media.jpg',
      '[{"src":"assets/images/retro-storage-media.jpg","caption":"Iomega Zip 100MB Disk 10-Pack + 3.5\" Floppy Bundle"}]'::jsonb,
      '{"Brand":"Iomega / Verbatim","ZipCapacity":"100MB per Cartridge (x10)","FloppyCapacity":"1.44MB 2HD (x20)","Format":"IBM / PC Formatted"}'::jsonb,
      '{"Cases":"10 Slim Jewel Cases Included","Labels":"Blank Label Sheet Included"}'::jsonb,
      '{}'::jsonb, FALSE
    );
  END IF;
END $$;
