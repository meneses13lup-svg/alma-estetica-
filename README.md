# 💆‍♀️ Alma Estética - Sistema de Gestión de Citas

¡Bienvenido al repositorio oficial de **Alma Estética**! Este es un sistema web completo (Full-Stack) diseñado para la gestión de citas de un salón de belleza, enfocado en la estética facial no quirúrgica. 

El proyecto integra un **Chatbot inteligente** con Procesamiento de Lenguaje Natural (PLN), pasarela de pagos, envío de correos automáticos y sincronización con Google Calendar.

## 🚀 Características Principales

- **🤖 Chatbot con PLN + LLM:** Asistente virtual ("Alma") que entiende lenguaje natural, detecta intenciones, emociones y responde de forma humana usando Google Gemini.
- **📅 Calendario Interactivo:** Los clientes pueden ver la disponibilidad de los especialistas en tiempo real y agendar su cita.
- **💳 Pasarela de Pagos (Mercado Pago):** Integración con Checkout Pro para el pago del depósito del 20% del tratamiento.
- **📧 Correos Automáticos:** Envío de correos de bienvenida, confirmación de cita y comprobante de pago (Nodemailer).
- **🗓️ Google Calendar:** Sincronización automática de las citas en el calendario de Google del cliente.
- **👥 Sistema de Roles:** 
  - *Clientes:* Agendan citas y ven su historial.
  - *Empleados:* Ven las citas de su sucursal.
  - *Administrador (Jefa):* Panel con estadísticas, ingresos y un **CMS (Gestor de Contenido)** para editar servicios y textos de la página sin programar.
- **📱 Diseño Responsive:** Interfaz adaptable a computadoras y celulares, con un diseño elegante en blanco y negro.

## 🛠️ Tecnologías Utilizadas

**Backend:**
- Node.js & Express
- SQLite (Base de datos)
- Google Generative AI (Gemini)
- Mercado Pago SDK
- Nodemailer
- Google APIs (Calendar)
- JSONWebToken / CORS / Dotenv

**Frontend:**
- HTML5, CSS3 y JavaScript (Vanilla)
- Fetch API para consumo de endpoints
- Google Fonts (Playfair Display e Inter)

## 📦 Instalación y Ejecución Local

Sigue estos pasos para correr el proyecto en tu computadora:

1. **Clona el repositorio:**
   ```bash
   git clone https://github.com/meneses13lup-svg/alma-estetica-.git