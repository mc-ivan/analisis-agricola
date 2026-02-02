# Análisis Agrícola Avanzado – Motacusito, Santa Cruz
**Autor:** Ivan Mamani Condori

Este repositorio contiene los datos, notebooks y resultados del análisis espacial avanzado del cultivo de maíz en la zona de Motacusito - Quita Bella Vista, Santa Cruz, Bolivia, utilizando imágenes satelitales, GIS y herramientas de procesamiento geoespacial en Google Colab.

## Contenido

### 1. Datos
- `data/area_motacusito.*` → Shapefiles de la zona de estudio (Santa Cruz – Motcusito, Quinta Bella Vista).  
- Datos raster descargados y exportados desde Google Earth Engine: NDVI, NDWI, SAVI, BSI, rendimiento estimado, balance hídrico, precipitación, temperatura, elevación, pendiente y zonas de manejo.

### 2. Notebooks
- [Práctica 4: Análisis Agrícola Avanzado](/notebook/Practica4_Analsis_agricola_avanzado.ipynb) → Notebook que incluye:
  - Carga y preprocesamiento de datos raster.
  - Cálculo de índices vegetativos e hídricos (NDVI, NDWI, SAVI, BSI, CSI).
  - Análisis estadístico y visualización de los resultados.
  - Generación automatizada de un informe técnico en Word.

### 3. Informe
- [Práctica 4: Informe](/notebook/Practica4-AnalisisAgricola-IvanMamani.pdf) → Documento que contiene:
  - Resumen ejecutivo del análisis agrícola.
  - Estadísticas descriptivas de los índices y rendimiento estimado.
  - Mapas zonales y gráficos de distribución.
  - Conclusiones y recomendaciones para gestión agrícola.

### 4. Resultados
- `results/figures/` → Figuras utilizadas en el informe:
  - `distribucion_indices.png` → Histogramas de distribución de los índices.
  - `mapas_generales.png` → Mapas zonales de NDVI, rendimiento y balance hídrico.
  - `logo_geonorth.png` → Logo de la empresa Geonorth.
- `results/resumen_estadistico.csv` → Tabla con estadísticas de todas las capas analizadas.
- `results/Informe_Tecnico_Geonorth.docx` → Informe técnico final.

### 5. Scripts
- `modeloAgriculturaSostenible.js` → Funciones y algoritmos para análisis agrícola y visualización geoespacial.
- `litio.js` → Scripts auxiliares (si aplica para visualización o integración).

## Notas
- El análisis integra datos satelitales, climáticos y geoespaciales mediante **Python**, **Google Colab**, **Google Earth Engine**, **Rasterio**, **GeoPandas**, **Matplotlib**, **Seaborn** y **Plotly**.  
- Se recomienda ejecutar el notebook en Google Colab para tener acceso directo a Google Drive y manejar los datos de manera eficiente.  
- Los resultados incluyen recomendaciones de manejo agrícola basadas en indicadores de vigor vegetal, balance hídrico y rendimiento del cultivo.

