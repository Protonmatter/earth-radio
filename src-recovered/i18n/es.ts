// Spanish catalog (partial on purpose — missing keys fall back to English, exercising the
// fallback contract in SPEC-I18N-001).
const es: Record<string, string> = {
  'app.tagline': 'Radio global resiliente',
  'status.initializing': 'Inicializando…',
  'status.loading': 'Cargando directorio de emisoras…',
  'status.playing': 'Reproduciendo {name}',

  'header.refresh': 'Actualizar',
  'header.export': 'Exportar',
  'header.import': 'Importar',
  'header.surprise': 'Sorpréndeme',
  'header.favorites': 'Solo favoritos',
  'header.filters': 'Filtros',
  'header.theme': 'Cambiar tema',

  'grid.all': 'Todas las emisoras',
  'grid.favorites': 'Favoritos',
  'grid.recent': 'Reproducidas recientemente',

  'player.select': 'Selecciona una emisora',
  'player.play': 'Reproducir',
  'player.pause': 'Pausa',

  'search.placeholder': 'Busca emisoras, países, etiquetas…',
  'search.empty': 'No se encontraron emisoras',

  'filters.title': 'Filtros',
  'filters.reset': 'Restablecer filtros'
};

export default es;
