/**
 * ==========================================================
 * PANEL DE CONTROL · Tienda Ame
 * Autor: Alain
 * Gestión del catálogo y ajustes vía GitHub Contents API
 * Repo: alain314159/Tienda-ame  ·  Rama: main
 * ==========================================================
 */

const REPO_OWNER  = 'alain314159';
const REPO_NAME   = 'Tienda-ame';
const REPO_BRANCH = 'main';
const API_BASE    = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

/**
 * Componente principal de Alpine.js.
 * Devuelve el estado, getters y métodos del panel.
 */
function panelApp() {
    return {
        /* ==================================================
         *                     ESTADO
         * ================================================== */
        token:        localStorage.getItem('gh_token') || '',
        tokenInput:   '',
        cargando:     false,
        errorLogin:   '',
        vista:        'login',          // 'login' | 'panel'
        config: {
            whatsapp_number: '',
            store_name:      'Tienda Ame',
            mensaje_bienvenida: '',
            moneda:          '',
            banner:          '',
            mantenimiento:   false,
            instagram:       '',
            facebook:        ''
        },
        productos:    [],
        tema:         localStorage.getItem('theme') || 'light',
        toast:        { show: false, mensaje: '', tipo: 'info' },
        modalAbierto: false,
        editando:     null,             // producto en edición (copia)
        imgNueva:     null,             // dataURL de imagen seleccionada
        colorNuevo:   '',
        confirmando:  null,             // producto pendiente de borrar
        publicando:   false,
        ajustes:      {},               // copia editable del config
        // Para rastrear SHA de archivos ya leídos (evita doble GET al escribir)
        _shas: { config: null, productos: null },

        /* ==================================================
         *                    GETTERS
         * ================================================== */
        get disponibles() {
            return this.productos.filter(p => p.estado === 'disponible').length;
        },
        get bajoPedido() {
            return this.productos.filter(p => p.estado === 'bajo_pedido').length;
        },
        get categorias() {
            return [...new Set(this.productos.map(p => p.categoria).filter(Boolean))];
        },

        /* ==================================================
         *                    MÉTODOS
         * ================================================== */

        /** Inicializa el panel al cargar la página. */
        init() {
            // Aplicar tema guardado
            if (this.tema === 'dark') {
                document.documentElement.classList.add('dark');
            }
            this.iconos();

            // Si ya hay token guardado, intentamos entrar silenciosamente
            if (this.token) {
                this.validarToken();
            }
        },

        /* ---------- Autenticación ---------- */

        /** Valida token contra GitHub y, si es OK, entra al panel. */
        async validarToken() {
            try {
                const res = await fetch('https://api.github.com/user', {
                    headers: this._headers()
                });
                if (res.ok) {
                    this.vista = 'productos';
                    this.cargarDatos();
                } else {
                    this.salir();
                    this.mostrarToast('Token inválido o expirado', 'error');
                }
            } catch (e) {
                this.mostrarToast('Error de conexión al validar', 'error');
            }
        },

        /** Login: valida el token introducido. */
        async entrar() {
            const t = this.tokenInput.trim();
            if (!t) {
                this.errorLogin = 'Introduce un token';
                return;
            }
            this.cargando = true;
            this.errorLogin = '';
            try {
                const res = await fetch('https://api.github.com/user', {
                    headers: {
                        'Authorization': `token ${t}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                if (res.ok) {
                    this.token = t;
                    localStorage.setItem('gh_token', t);
                    this.tokenInput = '';
                    this.vista = 'productos';
                    await this.cargarDatos();
                    this.mostrarToast('Sesión iniciada', 'success');
                } else {
                    this.errorLogin = 'Token inválido o sin permisos (necesita scope "repo")';
                }
            } catch (e) {
                this.errorLogin = 'Error de conexión';
            } finally {
                this.cargando = false;
                this.iconos();
            }
        },

        /** Cierra la sesión eliminando el token. */
        salir() {
            localStorage.removeItem('gh_token');
            this.token       = '';
            this.tokenInput  = '';
            this.vista       = 'login';
            this.productos   = [];
            this.config      = this._configVacio();
            this.ajustes     = {};
            this._shas       = { config: null, productos: null };
            this.iconos();
        },

        /* ---------- Tema ---------- */

        /** Alterna claro / oscuro. */
        toggleTheme() {
            this.tema = this.tema === 'light' ? 'dark' : 'light';
            localStorage.setItem('theme', this.tema);
            document.documentElement.classList.toggle('dark', this.tema === 'dark');
            this.iconos();
        },

        /* ---------- Carga / Lectura de datos ---------- */

        /** Carga config.json y productos.json desde el repo. */
        async cargarDatos() {
            this.cargando = true;
            try {
                const cfg = await this._leerArchivo('data/config.json', 'config');
                if (cfg) {
                    this.config  = this._normalizarConfig(cfg);
                    this.ajustes = this._clonar(this.config);
                }
                const prods = await this._leerArchivo('data/productos.json', 'productos');
                if (prods) {
                    const arr = Array.isArray(prods) ? prods : (prods.productos || []);
                    this.productos = this._normalizarProductos(arr);
                }
            } catch (e) {
                console.error('Error cargando datos:', e);
                this.mostrarToast('Error al cargar datos', 'error');
            } finally {
                this.cargando = false;
                this.iconos();
            }
        },

        /**
         * Lee un archivo del repo. Devuelve el JSON parseado y guarda el SHA
         * para la siguiente escritura (evita GET extra).
         */
        async _leerArchivo(ruta, claveSha) {
            const res = await fetch(`${API_BASE}/contents/${ruta}?ref=${REPO_BRANCH}`, {
                headers: this._headers()
            });
            if (res.status === 404) return null;          // archivo aún no existe
            if (!res.ok) throw new Error(`GET ${ruta} → ${res.status}`);

            const data = await res.json();
            this._shas[claveSha] = data.sha;              // guardar SHA para PUT

            // Decodificar base64 con decodificador UTF-8 seguro
            const bytes   = Uint8Array.from(atob(data.content), c => c.charCodeAt(0));
            const decoded = new TextDecoder('utf-8').decode(bytes);
            return JSON.parse(decoded);
        },

        /* ---------- Escritura en GitHub ---------- */

        /**
         * Sube/sobrescribe un archivo del repo.
         * @param {string} ruta          Ruta dentro del repo (p.ej. 'data/config.json')
         * @param {string} contenido     Texto a subir (UTF-8)
         * @param {string} mensaje       Mensaje del commit
         * @param {string} claveSha      Clave dentro de _shas para reutilizar SHA
         */
        async _escribirArchivo(ruta, contenido, mensaje, claveSha) {
            // Si no tenemos SHA (archivo nuevo o no leído), lo intentamos obtener
            if (!this._shas[claveSha]) {
                try {
                    const r = await fetch(`${API_BASE}/contents/${ruta}?ref=${REPO_BRANCH}`, {
                        headers: this._headers()
                    });
                    if (r.ok) {
                        const d = await r.json();
                        this._shas[claveSha] = d.sha;
                    }
                } catch (_) { /* archivo nuevo, no hay SHA */ }
            }

            const body = {
                message: mensaje,
                content: this._codificarBase64UTF8(contenido),
                branch:  REPO_BRANCH
            };
            if (this._shas[claveSha]) body.sha = this._shas[claveSha];

            const res = await fetch(`${API_BASE}/contents/${ruta}`, {
                method:  'PUT',
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept':        'application/vnd.github.v3+json',
                    'Content-Type':  'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`PUT ${ruta} → ${res.status}: ${errText}`);
            }

            const result = await res.json();
            // Actualizar SHA con el devuelto (para el próximo commit)
            this._shas[claveSha] = result.content.sha;
            return result;
        },

        /** Codifica texto UTF-8 a base64 seguro con caracteres no ASCII. */
        _codificarBase64UTF8(texto) {
            // Esquema estándar: btoa(unescape(encodeURIComponent(texto)))
            return btoa(unescape(encodeURIComponent(texto)));
        },

        /** Headers comunes para GET de la API. */
        _headers() {
            return {
                'Authorization': `token ${this.token}`,
                'Accept':        'application/vnd.github.v3+json'
            };
        },

        /* ---------- Normalización ---------- */

        _configVacio() {
            return {
                whatsapp_number: '',
                store_name:      'Tienda Ame',
                mensaje_bienvenida: '',
                moneda:          '',
                banner:          '',
                mantenimiento:   false,
                instagram:       '',
                facebook:        ''
            };
        },

        /** Normaliza el config añadiendo los campos nuevos con valores por defecto. */
        _normalizarConfig(c) {
            return {
                whatsapp_number:    String(c.whatsapp_number    || ''),
                store_name:         String(c.store_name         || 'Tienda Ame'),
                mensaje_bienvenida: String(c.mensaje_bienvenida || ''),
                moneda:             (c.moneda === undefined || c.moneda === null) ? '' : String(c.moneda),
                banner:             String(c.banner             || ''),
                mantenimiento:      Boolean(c.mantenimiento),
                instagram:          String(c.instagram          || ''),
                facebook:           String(c.facebook           || '')
            };
        },

        /** Normaliza array de productos: números, arrays y quita "/" inicial de imagen. */
        _normalizarProductos(arr) {
            return arr.map(p => ({
                id:          Number(p.id)        || 0,
                nombre:      String(p.nombre     || ''),
                precio:      Number(p.precio)    || 0,
                categoria:   String(p.categoria  || ''),
                descripcion: String(p.descripcion || ''),
                imagen:      this._normalizarImagen(p.imagen),
                colores:     Array.isArray(p.colores)
                                ? p.colores.map(c => String(c))
                                : [],
                accesorios:  Array.isArray(p.accesorios)
                                ? p.accesorios.map(a => ({
                                    nombre:      String(a?.nombre      || ''),
                                    precio_extra: Number(a?.precio_extra) || 0
                                  }))
                                : [],
                stock:       Number(p.stock)     || 0,
                estado:      p.estado === 'bajo_pedido' ? 'bajo_pedido' : 'disponible'
            }));
        },

        /** Quita "/" inicial de la ruta de imagen. Si viene vacío o es URL absoluta, la deja. */
        _normalizarImagen(img) {
            if (!img) return '';
            const s = String(img);
            // Si es URL absoluta (http/https), no tocar
            if (/^https?:\/\//i.test(s)) return s;
            // Quitar "/" inicial
            return s.replace(/^\/+/, '');
        },

        /* ---------- Iconos Lucide ---------- */

        /** Redibuja todos los iconos de Lucide tras el siguiente tick de Alpine. */
        iconos() {
            this.$nextTick(() => {
                if (window.lucide && typeof lucide.createIcons === 'function') {
                    lucide.createIcons();
                }
            });
        },

        /* ---------- Utilidades UI ---------- */

        /** Formatea un número como precio, con símbolo de moneda. */
        fmt(n) {
            const moneda = this.config.moneda || '';
            const num    = Number(n) || 0;
            // Formato con separadores locales y 2 decimales
            return moneda + num.toLocaleString('es', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        },

        /** Ruta de imagen correcta vista desde /panel/. */
        srcImg(img) {
            if (!img) return '';
            const s = String(img);
            if (/^https?:\/\//i.test(s)) return s;
            return '../' + s.replace(/^\.?\/+/, '');
        },

        /** Reemplaza imagen rota por un placeholder SVG. */
        imgError(ev) {
            if (ev && ev.target) {
                ev.target.src = "data:image/svg+xml;utf8," + encodeURIComponent(
                    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
                        <rect fill="#f3f4f6" width="200" height="200"/>
                        <text x="50%" y="50%" fill="#9ca3af" text-anchor="middle" dy=".3em"
                              font-family="system-ui" font-size="14">Sin imagen</text>
                     </svg>`
                );
            }
        },

        /** Muestra un toast durante 4 s. Tipos: 'info' | 'success' | 'error'. */
        mostrarToast(mensaje, tipo = 'info') {
            this.toast = { show: true, mensaje, tipo };
            this.iconos();
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => {
                this.toast.show = false;
            }, 4000);
        },

        /** Clona un objeto (para evitar mutaciones accidentales). */
        _clonar(obj) { return JSON.parse(JSON.stringify(obj)); },

        /* ---------- CRUD Productos ---------- */

        /** Abre el modal para crear un producto nuevo. */
        nuevo() {
            const maxId = this.productos.length
                ? Math.max(...this.productos.map(p => p.id))
                : 0;

            this.editando = {
                id:          maxId + 1,
                nombre:      '',
                precio:      0,
                categoria:   '',
                descripcion: '',
                imagen:      '',
                colores:     [],
                accesorios:  [],
                stock:       0,
                estado:      'disponible'
            };
            this.imgNueva    = null;
            this.colorNuevo  = '';
            this.modalAbierto = true;
            this.iconos();
        },

        /** Abre el modal para editar un producto existente (copia). */
        editar(p) {
            this.editando    = this._clonar(p);
            this.imgNueva    = null;
            this.colorNuevo  = '';
            this.modalAbierto = true;
            this.iconos();
        },

        /** Duplica un producto (id nuevo, " (copia)" al nombre) y abre editor. */
        duplicar(p) {
            const copia = this._clonar(p);
            const maxId = this.productos.length
                ? Math.max(...this.productos.map(x => x.id))
                : 0;
            copia.id     = maxId + 1;
            copia.nombre = p.nombre + ' (copia)';
            this.editando    = copia;
            this.imgNueva    = null;
            this.colorNuevo  = '';
            this.modalAbierto = true;
            this.iconos();
        },

        /** Pide confirmación para eliminar un producto. */
        pedirEliminar(p) {
            this.confirmando = p;
            this.iconos();
        },

        /** Ejecuta el borrado tras confirmar. */
        async confirmarEliminar() {
            if (!this.confirmando) return;
            const nombre = this.confirmando.nombre;
            const id     = this.confirmando.id;

            this.cargando = true;
            try {
                this.productos = this.productos.filter(p => p.id !== id);
                await this._escribirArchivo(
                    'data/productos.json',
                    JSON.stringify({ productos: this.productos }, null, 2),
                    `Panel: elimina "${nombre}"`,
                    'productos'
                );
                this.confirmando = null;
                this.mostrarToast('Producto eliminado', 'success');
            } catch (e) {
                console.error(e);
                this.mostrarToast('Error al eliminar: ' + e.message, 'error');
                // Recargar para resincronizar
                this.cargarDatos();
            } finally {
                this.cargando = false;
                this.iconos();
            }
        },

        /** Cierra el modal de edición. */
        cerrarEditor() {
            this.modalAbierto = false;
            this.editando     = null;
            this.imgNueva     = null;
            this.colorNuevo   = '';
        },

        /* ---------- Gestión de imagen en el editor ---------- */

        /** Callback del input file: guarda dataURL en imgNueva. */
        onImg(ev) {
            const file = ev?.target?.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                this.imgNueva = e.target.result;
                this.iconos();
            };
            reader.readAsDataURL(file);
        },

        /** Sube imgNueva al repo como static/images/<slug>-<ts>.jpg. */
        async _subirImagenNueva(nombreProducto) {
            // Extraer la parte base64 (tras la coma del dataURL)
            const [, base64Data] = this.imgNueva.split(',');
            const timestamp = Date.now();
            const slug = String(nombreProducto || 'producto')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 40) || 'producto';
            const rutaImagen = `static/images/${slug}-${timestamp}.jpg`;

            // Para imágenes subimos el binario codificado directamente en base64
            const res = await fetch(`${API_BASE}/contents/${rutaImagen}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept':        'application/vnd.github.v3+json',
                    'Content-Type':  'application/json'
                },
                body: JSON.stringify({
                    message: `Panel: añade imagen para "${nombreProducto}"`,
                    content: base64Data,
                    branch:  REPO_BRANCH
                })
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Subida imagen → ${res.status}: ${txt}`);
            }
            return rutaImagen; // SIN "/" inicial
        },

        /* ---------- Colores / Accesorios en el editor ---------- */

        addColor() {
            const v = (this.colorNuevo || '').trim();
            if (!v) return;
            if (!this.editando.colores) this.editando.colores = [];
            this.editando.colores.push(v);
            this.colorNuevo = '';
            this.iconos();
        },

        quitarColor(i) {
            this.editando.colores.splice(i, 1);
            this.iconos();
        },

        addAcc() {
            if (!this.editando.accesorios) this.editando.accesorios = [];
            this.editando.accesorios.push({ nombre: '', precio_extra: 0 });
            this.iconos();
        },

        quitarAcc(i) {
            this.editando.accesorios.splice(i, 1);
            this.iconos();
        },

        /* ---------- Guardar producto ---------- */

        async guardarProducto() {
            if (this.publicando) return;
            this.publicando = true;

            try {
                // 1) Si hay imagen nueva, subirla primero
                if (this.imgNueva) {
                    const ruta = await this._subirImagenNueva(this.editando.nombre);
                    this.editando.imagen = ruta; // sin "/" inicial
                    this.imgNueva = null;
                }

                // 2) Asegurar arrays y números antes de guardar
                this.editando.colores    = Array.isArray(this.editando.colores)    ? this.editando.colores    : [];
                this.editando.accesorios = Array.isArray(this.editando.accesorios) ? this.editando.accesorios : [];
                this.editando.precio     = Number(this.editando.precio)     || 0;
                this.editando.stock      = Number(this.editando.stock)      || 0;
                this.editando.accesorios = this.editando.accesorios.map(a => ({
                    nombre:       String(a.nombre || ''),
                    precio_extra: Number(a.precio_extra) || 0
                }));

                // 3) Actualizar o añadir en el array local
                const idx = this.productos.findIndex(p => p.id === this.editando.id);
                if (idx >= 0) {
                    this.productos[idx] = this._clonar(this.editando);
                } else {
                    this.productos.push(this._clonar(this.editando));
                }

                // 4) PUT del catálogo completo
                await this._escribirArchivo(
                    'data/productos.json',
                    JSON.stringify({ productos: this.productos }, null, 2),
                    'Panel: actualiza catálogo',
                    'productos'
                );

                this.cerrarEditor();
                this.mostrarToast('Producto guardado', 'success');
            } catch (e) {
                console.error(e);
                this.mostrarToast('Error al publicar: ' + e.message, 'error');
            } finally {
                this.publicando = false;
                this.iconos();
            }
        },

        /* ---------- Guardar ajustes ---------- */

        async guardarAjustes() {
            this.cargando = true;
            try {
                // Copiar los ajustes editados al config y persistir
                this.config = this._normalizarConfig(this.ajustes);
                await this._escribirArchivo(
                    'data/config.json',
                    JSON.stringify(this.config, null, 2),
                    'Panel: actualiza configuración',
                    'config'
                );
                this.ajustes = this._clonar(this.config);
                this.mostrarToast('Ajustes guardados', 'success');
            } catch (e) {
                console.error(e);
                this.mostrarToast('Error al guardar ajustes: ' + e.message, 'error');
            } finally {
                this.cargando = false;
                this.iconos();
            }
        }
    };
}

/* ==========================================================
 * Arranque: re-renderizar iconos de Lucide al cargar la página
 * (el resto ya se maneja con iconos() vía $nextTick).
 * ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
    if (window.lucide && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
});
