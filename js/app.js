/* ===== Tienda Amigurumis — lógica completa (Alpine.js) ===== */

const IMG_DEFAULT = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">' +
  '<rect width="400" height="400" fill="#fdf2f8"/>' +
  '<circle cx="200" cy="180" r="85" fill="#fbcfe8"/>' +
  '<circle cx="200" cy="180" r="85" fill="none" stroke="#f472b6" stroke-width="6" stroke-dasharray="14 10"/>' +
  '<path d="M120 300 q80 40 160 0" stroke="#f472b6" stroke-width="8" fill="none" stroke-linecap="round"/>' +
  '<text x="200" y="352" font-family="sans-serif" font-size="22" fill="#be185d" text-anchor="middle">Imagen no disponible</text></svg>'
);

function tiendaApp() {
  return {
    config: {
      whatsapp_number: '',
      store_name: 'Mi Tienda de Crochet',
      mensaje_bienvenida: '¡Hola! Quiero hacer un pedido:'
    },
    productos: [],
    error: false,
    categoriaActiva: 'Todos',
    busqueda: '',
    tema: 'light',

    modal: false,
    sel: null,
    cantidad: 1,
    colorSel: '',
    accSel: [],

    carritoAbierto: false,
    carrito: [],
    toast: '',
    _toastTimer: null,
    IMG_DEFAULT: IMG_DEFAULT,

    async init() {
      this.tema = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
      await this.cargarDatos();
      try { this.carrito = JSON.parse(localStorage.getItem('carrito') || '[]'); } catch (e) { this.carrito = []; }
      this.iconos();
    },

    async cargarDatos() {
      this.error = false;
      try {
        const r = await fetch('data/config.json', { cache: 'no-cache' });
        if (r.ok) this.config = Object.assign({}, this.config, await r.json());
      } catch (e) { console.error('No se pudo cargar config.json', e); }
      try {
        const r = await fetch('data/productos.json', { cache: 'no-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        this.productos = Array.isArray(d.productos) ? d.productos : [];
      } catch (e) { console.error('No se pudo cargar productos.json', e); this.error = true; }
      document.title = this.config.store_name;
      this.iconos();
    },

    /* ---------- derivados ---------- */
    get categorias() {
      return ['Todos', ...new Set(this.productos.map(p => p.categoria).filter(Boolean))];
    },

    /* ---------- utilidades ---------- */
    iconos() { this.$nextTick(() => { if (window.lucide) lucide.createIcons(); }); },
    fmt(n) { return '€' + (Number(n) || 0).toFixed(2); },
    estadoTexto(p) { return p.estado === 'disponible' ? '✅ Listo para enviar' : '🔄 Bajo pedido (7 días)'; },
    imgError(e) { if (e.target.src !== IMG_DEFAULT) e.target.src = IMG_DEFAULT; },
    filtrados() {
      const q = this.busqueda.trim().toLowerCase();
      return this.productos.filter(p =>
        (this.categoriaActiva === 'Todos' || p.categoria === this.categoriaActiva) &&
        (!q || ((p.nombre || '') + ' ' + (p.descripcion || '')).toLowerCase().includes(q))
      );
    },
    numWhatsApp() { return String(this.config.whatsapp_number || '').replace(/\D/g, ''); },
    mostrarToast(msg) {
      this.toast = msg;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { this.toast = ''; }, 2200);
    },

    /* ---------- tema ---------- */
    toggleTheme() {
      this.tema = this.tema === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', this.tema === 'dark');
      localStorage.setItem('theme', this.tema);
      this.iconos();
    },

    /* ---------- modal producto ---------- */
    abrirModal(p) {
      this.sel = p;
      this.cantidad = 1;
      this.colorSel = (p.colores && p.colores[0]) || '';
      this.accSel = [];
      this.modal = true;
      document.body.style.overflow = 'hidden';
      this.iconos();
      this.$nextTick(() => { if (this.$refs.btnCloseProd) this.$refs.btnCloseProd.focus(); });
    },
    cerrarModal() { this.modal = false; this.sel = null; document.body.style.overflow = ''; },
    toggleAcc(nombre) {
      this.accSel = this.accSel.includes(nombre)
        ? this.accSel.filter(a => a !== nombre)
        : [...this.accSel, nombre];
    },
    extrasUnit() {
      if (!this.sel || !this.sel.accesorios) return 0;
      return this.sel.accesorios
        .filter(a => this.accSel.includes(a.nombre))
        .reduce((s, a) => s + (Number(a.precio_extra) || 0), 0);
    },
    totalModal() { return this.sel ? (Number(this.sel.precio) + this.extrasUnit()) * this.cantidad : 0; },

    /* ---------- WhatsApp ---------- */
    abrirWhatsApp(mensaje) {
      const num = this.numWhatsApp();
      if (!num) { this.mostrarToast('⚠️ Número de WhatsApp no configurado'); return; }
      const url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(mensaje);
      const w = window.open(url, '_blank');
      if (!w) window.location.href = url; /* fallback para WebView / WebToApp */
    },
    mensajeProducto() {
      const p = this.sel;
      const l = [
        this.config.mensaje_bienvenida, '',
        '🧶 Producto: ' + p.nombre,
        '📦 Cantidad: ' + this.cantidad,
        '🎨 Color: ' + (this.colorSel || 'sin color'),
        '🎀 Accesorios: ' + (this.accSel.length ? this.accSel.join(', ') : 'ninguno'),
        '💰 Precio unitario: ' + this.fmt(p.precio)
      ];
      if (this.extrasUnit() > 0) l.push('➕ Extras por unidad: ' + this.fmt(this.extrasUnit()));
      l.push('💶 Total: ' + this.fmt(this.totalModal()));
      l.push('📌 Estado: ' + (p.estado === 'disponible' ? 'Listo para enviar' : 'Bajo pedido (7 días)'));
      return l.join('\n');
    },
    pedirProducto() { this.abrirWhatsApp(this.mensajeProducto()); },

    /* ---------- carrito ---------- */
    añadirCarrito() {
      const p = this.sel;
      const clave = p.id + '|' + this.colorSel + '|' + [...this.accSel].sort().join(',');
      const existente = this.carrito.find(i => i.clave === clave);
      if (existente) {
        existente.cantidad += this.cantidad;
      } else {
        this.carrito.push({
          clave: clave, id: p.id, nombre: p.nombre,
          imagen: p.imagen || IMG_DEFAULT,
          color: this.colorSel, accesorios: [...this.accSel],
          precioUnit: Number(p.precio) + this.extrasUnit(),
          cantidad: this.cantidad,
          detalle: (this.colorSel || 'sin color') + (this.accSel.length ? ' · ' + this.accSel.join(', ') : '')
        });
      }
      this.guardarCarrito();
      this.mostrarToast('🛒 Añadido al carrito');
      this.iconos();
    },
    guardarCarrito() { localStorage.setItem('carrito', JSON.stringify(this.carrito)); },
    cartCount() { return this.carrito.reduce((s, i) => s + i.cantidad, 0); },
    cartTotal() { return this.carrito.reduce((s, i) => s + i.precioUnit * i.cantidad, 0); },
    cambiarCant(idx, d) {
      this.carrito[idx].cantidad = Math.max(1, this.carrito[idx].cantidad + d);
      this.guardarCarrito(); this.iconos();
    },
    quitar(idx) { this.carrito.splice(idx, 1); this.guardarCarrito(); this.iconos(); },
    vaciarCarrito() { this.carrito = []; this.guardarCarrito(); },
    abrirCarrito() {
      this.carritoAbierto = true;
      document.body.style.overflow = 'hidden';
      this.iconos();
      this.$nextTick(() => { if (this.$refs.btnCloseCart) this.$refs.btnCloseCart.focus(); });
    },
    cerrarCarrito() { this.carritoAbierto = false; document.body.style.overflow = ''; },
    pedirCarrito() {
      if (!this.carrito.length) return;
      const l = [this.config.mensaje_bienvenida, '', '🧺 PEDIDO COMPLETO:', ''];
      this.carrito.forEach(i => {
        l.push('• ' + i.cantidad + '× ' + i.nombre + ' (' + i.detalle + ') — ' + this.fmt(i.precioUnit * i.cantidad));
      });
      l.push('', '💶 Total: ' + this.fmt(this.cartTotal()));
      this.abrirWhatsApp(l.join('\n'));
    },

    /* ---------- compartir ---------- */
    async compartir() {
      const data = {
        title: this.sel.nombre,
        text: this.sel.nombre + ' — ' + this.fmt(this.sel.precio) + ' en ' + this.config.store_name,
        url: location.href
      };
      if (navigator.share) { try { await navigator.share(data); } catch (e) {} }
      else {
        try { await navigator.clipboard.writeText(data.text + ' ' + data.url); this.mostrarToast('🔗 Enlace copiado'); } catch (e) {}
      }
    },

    /* ---------- accesibilidad: focus trap ---------- */
    trapFocus(e, contenedor) {
      const f = contenedor.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const primero = f[0], ultimo = f[f.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }
  };
}