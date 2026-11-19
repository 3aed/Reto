import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

const STATIC_HTML_PAGES = [
  'index.html',
  'marketplace.html',
  'categories.html',
  'product.html',
  'cart.html',
  'checkout.html',
  'payment.html',
  'orders.html',
  'contact.html',
];

export default defineConfig(() => {
  return {
    plugins: [
      {
        name: 'copy-static-retromarket-files',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          if (!fs.existsSync(distDir)) {
            fs.mkdirSync(distDir, { recursive: true });
          }

          for (const htmlFile of STATIC_HTML_PAGES) {
            const srcHtml = path.resolve(__dirname, htmlFile);
            const destHtml = path.resolve(distDir, htmlFile);
            if (fs.existsSync(srcHtml)) {
              fs.copyFileSync(srcHtml, destHtml);
            }
          }

          for (const dirName of ['css', 'js', 'assets']) {
            const srcDir = path.resolve(__dirname, dirName);
            const destDir = path.resolve(distDir, dirName);
            if (fs.existsSync(srcDir)) {
              fs.cpSync(srcDir, destDir, { recursive: true, force: true });
            }
          }
        },
      },
    ],
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
