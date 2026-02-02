// ==============================================
// MODELOS DE AGRICULTURA SOSTENIBLE
// Predicción de Rendimientos y Manejo de Nutrientes
// ==============================================

// 1. DEFINICIÓN DE ÁREA DE ESTUDIO Y PERÍODO
// ==============================================

// Cargar área de estudio desde Assets
var area_est = ee.FeatureCollection('projects/wccrm-366017/assets/area_motacusito');
var geometry = area_est.geometry();

// Verificar el área cargada
print('Área de estudio cargada:', area_est);
print('Número de polígonos:', area_est.size());

// Visualizar el área
Map.centerObject(geometry, 12);
Map.addLayer(area_est, {color: 'FF0000'}, 'Área La Cruz');

var startDate = '2023-09-01';
var endDate = '2025-03-31';

// 2. FUNCIONES DE PREPROCESAMIENTO
// ==============================================

// Función para aplicar máscara de nubes a Sentinel-2
function maskS2clouds(image) {
  var qa = image.select('QA60');
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
               .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
  return image.updateMask(mask)
              .divide(10000)
              .copyProperties(image, ['system:time_start']);
}

// Función para aplicar máscara de nubes a Landsat
function maskL8clouds(image) {
  var qa = image.select('QA_PIXEL');
  var mask = qa.bitwiseAnd(1 << 3).eq(0)  // nubes
               .and(qa.bitwiseAnd(1 << 4).eq(0));  // sombra de nubes
  return image.updateMask(mask)
              .copyProperties(image, ['system:time_start']);
}

// 3. CARGA Y FILTRADO DE IMÁGENES
// ==============================================

// Sentinel-2 (10m)
var sentinel2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterDate(startDate, endDate)
  .filterBounds(geometry)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(maskS2clouds);

print('Sentinel-2 images:', sentinel2.size());

// Landsat 8-9 (30m)
var landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterDate(startDate, endDate)
  .filterBounds(geometry)
  .filter(ee.Filter.lt('CLOUD_COVER', 30))
  .map(maskL8clouds);

print('Landsat images:', landsat.size());

// 4. CÁLCULO DE ÍNDICES ESPECTRALES
// ==============================================

// Función para calcular índices
function calculateIndices(image) {
  // NDVI - Índice de vegetación
  var ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  
  // NDWI - Índice de agua
  var ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');
  
  // MNDWI - Índice modificado de agua
  var mndwi = image.normalizedDifference(['B3', 'B11']).rename('MNDWI');
  
  // Bare Soil Index
  var bsi = image.expression(
    '((B11 + B4) - (B8 + B2)) / ((B11 + B4) + (B8 + B2))', {
      'B2': image.select('B2'),
      'B4': image.select('B4'),
      'B8': image.select('B8'),
      'B11': image.select('B11')
    }).rename('BSI');
  
  // SAVI - Soil Adjusted Vegetation Index
  var savi = image.expression(
    '((NIR - RED) / (NIR + RED + 0.5)) * 1.5', {
      'NIR': image.select('B8'),
      'RED': image.select('B4')
    }).rename('SAVI');
  
  return image.addBands([ndvi, ndwi, mndwi, bsi, savi]);
}

// Aplicar índices a Sentinel-2
var sentinel2_withIndices = sentinel2.map(calculateIndices);

// 5. COMPOSICIÓN TEMPORAL (MEDIANA)
// ==============================================
var s2_composite = sentinel2_withIndices.median().clip(geometry);

// 6. CARGA DE DATOS METEOROLÓGICOS Y DE SUELO
// ==============================================

// Precipitación CHIRPS DAILY
var chirps_daily = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterDate(startDate, endDate)
  .filterBounds(geometry)
  .sum()
  .clip(geometry)
  .rename('precipitation');

print('Precipitación CHIRPS cargada');

// Temperatura (ERA5) - datos mensuales
var era5 = ee.ImageCollection('ECMWF/ERA5_LAND/MONTHLY_AGGR')
  .filterDate(startDate, endDate)
  .filterBounds(geometry)
  .select(['temperature_2m', 'total_precipitation_sum'])
  .mean()
  .clip(geometry);

// Convertir temperatura de Kelvin a Celsius
var temperature = era5.select('temperature_2m').subtract(273.15).rename('temperature');
var era5_precip = era5.select('total_precipitation_sum').multiply(1000).rename('era5_precip');

print('Temperatura ERA5 cargada');

// Topografía (SRTM)
var dem = ee.Image('USGS/SRTMGL1_003').clip(geometry).rename('elevation');
var slope = ee.Terrain.slope(dem).rename('slope');

// 7. MODELOS DE ESTIMACIÓN DE RENDIMIENTO
// ==============================================

// Modelo simplificado basado en NDVI para maíz
function estimateYield(ndviImage) {
  var maxYield = 10000;
  var ndviThreshold = 0.75;
  
  var yieldEstimate = ndviImage.expression(
    'max_yield * (ndvi / ndvi_threshold)', {
      'ndvi': ndviImage.select('NDVI'),
      'max_yield': maxYield,
      'ndvi_threshold': ndviThreshold
    }).clamp(0, maxYield).rename('yield_estimate');
  
  return yieldEstimate;
}

// Modelo de biomasa basado en NDVI
function estimateBiomass(ndviImage) {
  var biomass = ndviImage.expression(
    '8 * exp(2.3 * ndvi)', {
      'ndvi': ndviImage.select('NDVI')
    }).rename('biomass_kg_m2');
  
  return biomass;
}

// Aplicar modelos
var yieldMap = estimateYield(s2_composite);
var biomassMap = estimateBiomass(s2_composite);

// 8. BALANCE HÍDRICO
// ==============================================

// Evapotranspiración de referencia (simplificada)
function calculateET0(tempImage) {
  var et0 = tempImage.expression(
    '0.0023 * 15 * (temp + 17.8) * sqrt(25)', {
      'temp': tempImage
    }).rename('ET0');
  
  return et0;
}

// Coeficiente de cultivo basado en NDVI
function calculateKc(ndviImage) {
  var kc = ndviImage.expression(
    '1.0 + (0.2 * ndvi)', {
      'ndvi': ndviImage.select('NDVI')
    }).clamp(0.2, 1.2).rename('Kc');
  
  return kc;
}

// Calcular balance hídrico
var et0 = calculateET0(temperature);
var kc = calculateKc(s2_composite);
var etc = et0.multiply(kc).rename('ETc');
var waterBalance = chirps_daily.subtract(etc).rename('water_balance');

// 9. DETECCIÓN DE ESTRÉS
// ==============================================

// Estrés hídrico (balance negativo)
var waterStress = waterBalance.lt(-50)
  .rename('water_stress')
  .selfMask();

// Estrés nutricional (suelo expuesto + baja vegetación)
var nutrientStress = s2_composite.expression(
  'BSI > 0.1 && NDVI < 0.5', {
    'BSI': s2_composite.select('BSI'),
    'NDVI': s2_composite.select('NDVI')
}).rename('nutrient_stress').selfMask();

// 10. CLASIFICACIÓN DE ZONAS HOMOGÉNEAS
// ==============================================

var bandsForClustering = ['B2', 'B3', 'B4', 'B8', 'B11', 'NDVI'];
var training = s2_composite.select(bandsForClustering).sample({
  region: geometry,
  scale: 20,
  numPixels: 5000
});

var clusterer = ee.Clusterer.wekaKMeans(5).train(training);
var clustered = s2_composite.select(bandsForClustering).cluster(clusterer);
var zones = clustered.rename('management_zones');

// 11. VISUALIZACIÓN
// ==============================================

var visParamsRGB = {
  bands: ['B4', 'B3', 'B2'],
  min: 0,
  max: 0.3
};

var visParamsNDVI = {
  min: 0,
  max: 1,
  palette: ['brown', 'yellow', 'green']
};

var visParamsYield = {
  min: 0,
  max: 10000,
  palette: ['red', 'yellow', 'green']
};

var visParamsWater = {
  min: -200,
  max: 200,
  palette: ['red', 'white', 'blue']
};

var visParamsZones = {
  min: 0,
  max: 4,
  palette: ['#d73027', '#fc8d59', '#fee08b', '#91bfdb', '#4575b4']
};

// Añadir capas al mapa
Map.addLayer(s2_composite, visParamsRGB, 'Sentinel-2 RGB', false);
Map.addLayer(s2_composite.select('NDVI'), visParamsNDVI, 'NDVI');
Map.addLayer(yieldMap, visParamsYield, 'Rendimiento estimado (kg/ha)', false);
Map.addLayer(waterBalance, visParamsWater, 'Balance Hídrico (mm)', false);
Map.addLayer(waterStress, {palette: ['yellow', 'red']}, 'Estrés Hídrico', false);
Map.addLayer(nutrientStress, {palette: ['orange', 'red']}, 'Estrés Nutricional', false);
Map.addLayer(zones, visParamsZones, 'Zonas de Manejo', false);

// 12. ANÁLISIS ESTADÍSTICO
// ==============================================

// *** CORRECCIÓN: Convertir todas las bandas a Float32 para compatibilidad ***
var analysisImage = ee.Image.cat([
  s2_composite.select(['NDVI', 'NDWI', 'SAVI', 'BSI']).toFloat(),
  yieldMap.toFloat(),
  biomassMap.toFloat(),
  waterBalance.toFloat(),
  waterStress.unmask(0).toFloat(),
  nutrientStress.unmask(0).toFloat(),
  zones.toFloat(),
  chirps_daily.toFloat(),
  temperature.toFloat(),
  dem.toFloat(),
  slope.toFloat()
]);

// Calcular estadísticas para toda el área
var areaStats = analysisImage.reduceRegion({
  reducer: ee.Reducer.mean().combine({
    reducer2: ee.Reducer.stdDev(),
    sharedInputs: true
  }),
  geometry: geometry,
  scale: 20,
  maxPixels: 1e9
});

print('Estadísticas del área de estudio:', areaStats);

// Calcular estadísticas por parcela
var parcelStats = analysisImage.reduceRegions({
  collection: area_est,
  reducer: ee.Reducer.mean(),
  scale: 20
});

print('Estadísticas por parcela (primeras 5):', parcelStats.limit(5));

// 13. EXPORTACIÓN DE DATOS - VERSIÓN CORREGIDA
// ==============================================

// *** OPCIÓN 1: EXPORTAR BANDAS INDIVIDUALES (RECOMENDADO) ***
// Exportar cada índice por separado para evitar conflictos de tipo de datos

// NDVI
Export.image.toDrive({
  image: s2_composite.select('NDVI').toFloat(),
  description: 'NDVI_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'ndvi_lacruz',
  region: geometry,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// SAVI
Export.image.toDrive({
  image: s2_composite.select('SAVI').toFloat(),
  description: 'SAVI_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'savi_lacruz',
  region: geometry,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// NDWI
Export.image.toDrive({
  image: s2_composite.select('NDWI').toFloat(),
  description: 'NDWI_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'ndwi_lacruz',
  region: geometry,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// BSI
Export.image.toDrive({
  image: s2_composite.select('BSI').toFloat(),
  description: 'BSI_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'bsi_lacruz',
  region: geometry,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// Rendimiento estimado
Export.image.toDrive({
  image: yieldMap.toFloat(),
  description: 'Yield_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'yield_estimate_lacruz',
  region: geometry,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// Balance hídrico
Export.image.toDrive({
  image: waterBalance.toFloat(),
  description: 'WaterBalance_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'water_balance_lacruz',
  region: geometry,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// Precipitación
Export.image.toDrive({
  image: chirps_daily.toFloat(),
  description: 'Precipitation_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'precipitation_lacruz',
  region: geometry,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// Temperatura
Export.image.toDrive({
  image: temperature.toFloat(),
  description: 'Temperature_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'temperature_lacruz',
  region: geometry,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// Elevación
Export.image.toDrive({
  image: dem.toFloat(),
  description: 'Elevation_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'elevation_lacruz',
  region: geometry,
  scale: 30,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// Pendiente
Export.image.toDrive({
  image: slope.toFloat(),
  description: 'Slope_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'slope_lacruz',
  region: geometry,
  scale: 30,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// Zonas de manejo
Export.image.toDrive({
  image: zones.toFloat(),
  description: 'Zones_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'management_zones_lacruz',
  region: geometry,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// *** OPCIÓN 2: EXPORTAR IMAGEN COMPLETA (ALTERNATIVA) ***
// Si prefieres exportar todo junto (más lento pero un solo archivo)
Export.image.toDrive({
  image: analysisImage,
  description: 'Agricultura_Sostenible_LaCruz_Completa',
  folder: 'GEE_Exports',
  fileNamePrefix: 'modelo_agricultura_lacruz_completo',
  region: geometry,
  scale: 10,
  maxPixels: 1e13,
  crs: 'EPSG:4326'
});

// Exportar estadísticas por parcela (CSV)
Export.table.toDrive({
  collection: parcelStats,
  description: 'Estadisticas_Parcelas_LaCruz',
  folder: 'GEE_Exports',
  fileNamePrefix: 'estadisticas_parcelas_lacruz',
  fileFormat: 'CSV'
});

// 14. GRÁFICOS Y ANÁLISIS TEMPORAL
// ==============================================

var ndviTimeSeries = ui.Chart.image.seriesByRegion({
  imageCollection: sentinel2_withIndices.select('NDVI'),
  regions: area_est,
  reducer: ee.Reducer.mean(),
  scale: 20,
  xProperty: 'system:time_start'
})
.setChartType('LineChart')
.setOptions({
  title: 'Evolución Temporal del NDVI - La Cruz',
  hAxis: {title: 'Fecha', format: 'MMM yyyy'},
  vAxis: {title: 'NDVI', minValue: 0, maxValue: 1},
  lineWidth: 2,
  pointSize: 3
});

print('Serie temporal de NDVI:', ndviTimeSeries);

var yieldHistogram = ui.Chart.image.histogram({
  image: yieldMap,
  region: geometry,
  scale: 20,
  maxBuckets: 30
})
.setOptions({
  title: 'Distribución de Rendimientos Estimados',
  hAxis: {title: 'Rendimiento (kg/ha)'},
  vAxis: {title: 'Frecuencia'},
  colors: ['green']
});

print('Histograma de rendimientos:', yieldHistogram);

// 15. INTERFAZ DE USUARIO
// ==============================================

var panel = ui.Panel({
  style: {
    position: 'top-right',
    padding: '10px',
    width: '300px'
  }
});

var title = ui.Label({
  value: 'ANÁLISIS AGRÍCOLA - LA CRUZ',
  style: {
    fontSize: '16px',
    fontWeight: 'bold',
    margin: '0 0 10px 0',
    textAlign: 'center'
  }
});

panel.add(title);

var layerSelector = ui.Select({
  items: [
    'Imagen RGB',
    'NDVI',
    'Rendimiento',
    'Balance Hídrico',
    'Estrés Hídrico',
    'Estrés Nutricional',
    'Zonas de Manejo'
  ],
  placeholder: 'Seleccionar capa',
  style: {margin: '5px 0'}
});

layerSelector.onChange(function(value) {
  var layers = Map.layers();
  for (var i = layers.length() - 1; i >= 0; i--) {
    var layer = layers.get(i);
    if (layer.getName() !== 'Área La Cruz') {
      layers.remove(layer);
    }
  }
  
  switch(value) {
    case 'Imagen RGB':
      Map.addLayer(s2_composite, visParamsRGB, 'Sentinel-2 RGB');
      break;
    case 'NDVI':
      Map.addLayer(s2_composite.select('NDVI'), visParamsNDVI, 'NDVI');
      break;
    case 'Rendimiento':
      Map.addLayer(yieldMap, visParamsYield, 'Rendimiento estimado (kg/ha)');
      break;
    case 'Balance Hídrico':
      Map.addLayer(waterBalance, visParamsWater, 'Balance Hídrico (mm)');
      break;
    case 'Estrés Hídrico':
      Map.addLayer(waterStress, {palette: ['yellow', 'red']}, 'Estrés Hídrico');
      break;
    case 'Estrés Nutricional':
      Map.addLayer(nutrientStress, {palette: ['orange', 'red']}, 'Estrés Nutricional');
      break;
    case 'Zonas de Manejo':
      Map.addLayer(zones, visParamsZones, 'Zonas de Manejo');
      break;
  }
});

panel.add(ui.Label('Capa activa:'));
panel.add(layerSelector);

var exportButton = ui.Button({
  label: '📥 Exportar Datos',
  onClick: function() {
    print('=== INSTRUCCIONES DE EXPORTACIÓN ===');
    print('1. Ve a la pestaña "Tasks" (arriba a la derecha)');
    print('2. Haz clic en "Run" para cada tarea de exportación');
    print('3. Se exportarán 11 archivos individuales + 1 CSV');
    print('4. Los datos se guardarán en tu Google Drive/GEE_Exports');
    print('====================================');
    print('ARCHIVOS A EXPORTAR:');
    print('- ndvi_lacruz.tif');
    print('- savi_lacruz.tif');
    print('- ndwi_lacruz.tif');
    print('- bsi_lacruz.tif');
    print('- yield_estimate_lacruz.tif');
    print('- water_balance_lacruz.tif');
    print('- precipitation_lacruz.tif');
    print('- temperature_lacruz.tif');
    print('- elevation_lacruz.tif');
    print('- slope_lacruz.tif');
    print('- management_zones_lacruz.tif');
    print('- estadisticas_parcelas_lacruz.csv');
    print('====================================');
  },
  style: {margin: '10px 0', backgroundColor: '#4CAF50', color: 'white'}
});

var statsButton = ui.Button({
  label: '📊 Ver Estadísticas',
  onClick: function() {
    print('=== ESTADÍSTICAS RESUMEN ===');
    print('Área de estudio: La Cruz');
    print('Período:', startDate, 'a', endDate);
    print('Imágenes Sentinel-2:', sentinel2.size());
    print('Imágenes Landsat:', landsat.size());
    print('====================================');
  },
  style: {margin: '5px 0', backgroundColor: '#2196F3', color: 'white'}
});

panel.add(exportButton);
panel.add(statsButton);

var legendTitle = ui.Label({
  value: 'Leyenda NDVI:',
  style: {fontWeight: 'bold', margin: '10px 0 5px 0'}
});

panel.add(legendTitle);

var legendItems = [
  {color: 'brown', label: '0.0-0.3: Suelo/Baja vegetación'},
  {color: 'yellow', label: '0.3-0.6: Vegetación moderada'},
  {color: 'green', label: '0.6-1.0: Vegetación densa'}
];

legendItems.forEach(function(item) {
  var legendRow = ui.Panel({
    widgets: [
      ui.Label({
        value: '■',
        style: {color: item.color, fontSize: '20px', margin: '0 5px'}
      }),
      ui.Label(item.label)
    ],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
  panel.add(legendRow);
});

Map.add(panel);

// 16. INFORMACIÓN DE SALIDA
// ==============================================

print('=============================================');
print('ANÁLISIS COMPLETADO EXITOSAMENTE');
print('=============================================');
print('Resultados generados:');
print('1. Mapas de rendimiento estimado');
print('2. Análisis de balance hídrico');
print('3. Detección de zonas de estrés');
print('4. Clasificación de zonas homogéneas');
print('5. Estadísticas por parcela');
print('=============================================');
print('Para exportar datos, haz clic en el botón');
print('"📥 Exportar Datos" o ve a la pestaña "Tasks"');
print('=============================================');
print('');
print('NOTA IMPORTANTE:');
print('Se han creado 12 tareas de exportación separadas');
print('para evitar errores de tipo de datos.');
print('Ejecuta cada una desde la pestaña Tasks.');
print('=============================================');