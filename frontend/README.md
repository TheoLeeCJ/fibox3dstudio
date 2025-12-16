# 3D Studio - Interior Design Generator

A professional interior design tool inspired by creative applications like Blender and Premiere Pro.

## Setup

1. Install dependencies:
```bash
npm install
# or
pnpm install
```

2. Add template image:
   - Place a bedroom image named `image.png` in the `public/` folder
   - This will be used as the "Bedroom" template

3. Run development server:
```bash
npm run dev
# or
pnpm dev
```

## Features

### Ideation Tab
- **Template Selection**: Choose from predefined room templates or upload custom inspiration
- **Object Management**: View, add, and remove objects from the scene
- **AI-Powered Chat**: Modify scenes using natural language commands
- **Accept/Reject Flow**: Review changes before applying them

### Import/Export
- Export projects as JSON (includes structured prompts, seeds, and image references)
- Import previously saved projects

## Architecture

- **Vue 3**: Component-based reactive UI
- **Tailwind CSS**: Utility-first styling from CDN
- **Bria FIBO API**: AI-powered image generation
- **Gemini 2.0 Flash**: Scene and object analysis

## Key Components

- `IdeationTab.vue`: Main workspace with three-panel layout
- `ObjectsPanel.vue`: Object list with add/delete functionality
- `ContentArea.vue`: Image display with template selection
- `ChatPanel.vue`: Natural language scene modification
- `ImportExport.vue`: Project data management

## Data Format

Exported JSON structure:
```json
{
  "version": "1.0",
  "timestamp": "ISO 8601 timestamp",
  "structuredPrompt": { /* FIBO structured prompt */ },
  "seed": 123456,
  "imageUrl": "https://...",
  "furnitureList": "Gemini-generated list"
}
```
