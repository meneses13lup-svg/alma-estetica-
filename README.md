#  Alma Estética - Sistema de Gestión de Citas

##  Integrantes del Equipo
- **Meneses Atzin Lesly Guadalupe** - Developer Backend
- **Venegas Alvarado Aranza Citlami** - Developer Frontend
- **Hernández Ruiz Lorena de Abril** - Developer Frontend
- **Bartolo Herrera Héctor** - Data Base Designer
- **Sánchez Vera Julio Ángel** - UI Designer
- **Monroy Díaz Joshua Emmanuel** - Project Manager / Data Analyst
- **Ortiz Maldonado María Ivonne** - Project Manager / Documentación
- **Velazques Juarez Aixa Michelle** - Documentación
- **Mendoza Montiel Martín Oscar** - Documentación

##  Descripción del Problema
Actualmente, los salones de belleza independientes (como el de la cliente Esmeralda) gestionan sus citas mediante WhatsApp y libretas físicas. Esto provoca conflictos de horarios, pérdida de clientes por falta de respuesta y una nula personalización en el servicio. Además, no cuentan con un control de pagos anticipados ni con un historial clínico de las clientas.

##  Objetivo del Sistema
Desarrollar una aplicación web integral que automatice la gestión de citas, permita el pago de un depósito del 20% en línea para asegurar la asistencia, y ofrezca atención al cliente 24/7 mediante un Chatbot inteligente con Procesamiento de Lenguaje Natural (PLN) que responda dudas y asista en el agendamiento.

##  Estado Actual del Proyecto
El sistema se encuentra **completamente funcional** y listo para su evaluación. Las características implementadas son:
-  **Módulo de Usuarios:** Registro, inicio de sesión y validaciones de edad.
-  **Catálogo y Agenda:** Visualización de servicios y calendario interactivo para seleccionar especialista y horario.
-  **Chatbot Inteligente:** Implementación de motor PLN propio (léxico y reglas) + integración con LLM (Gemini) para respuestas naturales.
-  **Pasarela de Pagos:** Integración completa con Mercado Pago (Checkout Pro) para el depósito del 20%.
-  **Dashboards:** Paneles de control para Clientes, Empleados y Administradora (con CMS para editar la página).
-  **Notificaciones:** Envío de correos de bienvenida y confirmación con Nodemailer.
-  **Google Calendar:** Sincronización de citas previa autorización del usuario.

##  Tecnologías Utilizadas
- **Backend:** Node.js, Express, SQL, Google Generative AI (Gemini), Mercado Pago SDK, Nodemailer, Google APIs (Calendar).
- **Frontend:** HTML5, CSS3, JavaScript (Vanilla), Fetch API.
- **Control de versiones:** Git y GitHub.

##  Instalación y Ejecución Local

1. **Clona el repositorio:**
   ```bash
   git clone https://github.com/meneses13lup-svg/alma-estetica-.git