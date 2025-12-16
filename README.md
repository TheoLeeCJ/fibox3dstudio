![](https://i.imgur.com/VAmsvDQ.png)
# Watch the video: https://www.youtube.com/watch?v=tTuT6ZODGsA

## Inspiration
While traditional AI image generation is helpful for brainstorming, it is sometimes a bottleneck for actual production. You can prompt a room and get a stunning image, but the moment you need to move a chair or shift the lighting, you’re stuck. Change one word, and the entire room hallucinates into something else. Change a camera angle, but try as you might, the model does not understand.

We realized that to turn GenAI into a professional design workflow, we needed control. We needed a model that spoke the language of structure - JSON - rather than vague poetry.

**Bria FIBO was the missing link. By leveraging FIBO’s revolutionary JSON-native, disentangled generation, we realized we could finally bridge the gap between a pretty 2D picture, a version-controlled workflow with robust change tracking, and a fully functional, editable 3D workspace.**

![](https://i.imgur.com/fTgDcvX.gif)

## What it does
FIBOx3D Studio is a next-generation design suite that transforms the lottery-like experience of image generation into a precise, version-controlled 3D workflow, enabled by Bria FIBO and fal.ai.

### Robust Change Tracking
![](https://i.imgur.com/LftQKi9.png)

FIBOx3D Studio tracks every change made to the scene with snapshots and textual diffs, made possible by FIBO's **JSON-native generation**. You can **restore** an earlier snapshot if you made a mistake, or even **fork** the project to create a new variation.

**This brings robust change tracking and version control to your FIBO designs.**

### Click-to-edit & Disentangled editing
![](https://i.imgur.com/eQfQ1ac.gif)

You can intuitively click on objects within the image to instruct FIBO to edit them. Thanks to **FIBO’s disentangled generation**, you can edit a single object (like changing a pillow color) without the "butterfly effect" ruining the rest of the room. This is a game-changer for consistency.

### Imagine in 2D, Edit in 3D
![](https://i.imgur.com/zPXGugi.gif)

Once you have your scene created in 2D with FIBO, you can turn it into a 3D scene with just one click. Like magic, our agentic workflow takes over, using **FIBO's JSON-native disentangled generation** to "segment" individual assets, and Google Gemini to project positions into a floor plan. **fal.ai's Trellis 3D generation API** processes images into 3D models and X3D intelligently places the furniture into a 3D scene.

**Crucially, X3D is able to get all the scales and positions mostly correct, thanks to the generated floor plan and our intelligent placement algorithm. Users can manually position, scale and duplicate objects to test out different looks with pixel-perfect alignment.**

### Edit 3D Assets
![](https://i.imgur.com/vbbuFFF.png)

Use FIBO to edit 3D assets. Simply click on an object and tell FIBO how you want to change it. FIBO instantly creates a new mockup, which fal.ai's Trellis 3D generation can turn into a new model and swap into the scene for use.

**All generated 3D assets can also be downloaded and imported into industry-standard tools like Blender. FIBOx3D Studio useful for not just for interior design, but also for game developers for instant asset prototyping.**

![](https://i.imgur.com/Qw7N3Sq.png)

### Neural Rendering
Once the 3D layout and composition are perfect, we feed the coordinates back into FIBO. The model acts as a "neural renderer," applying photorealistic HDR lighting and polish while strictly obeying the user's 3D composition.

### Commercial safety
Because **Bria** is built on fully licensed data, every asset generated in FIBOx3D is safe for commercial use - a critical feature for our target audience of professional interior designers and game devs.

### Add inspiration to FIBO scene from URL
![](https://i.imgur.com/aEnXPnu.png)

## How we built it
This project is a symphony of best-in-class AI tools, with **Bria FIBO** acting as the conductor.

1.  **Image and Scene Generation (Bria FIBO):** The entire application state is managed by FIBO's JSON structure. We use it to generate the initial concept, ensuring that every element—from the "soft morning light" to the "oak texture"—is defined as a manipulatable variable, not just pixels.
2.  **3D (fal.ai):** For the 3D conversion, speed was non-negotiable. We utilized **fal.ai's hosted Trellis 3D generation model**. Fal’s blazing-fast inference allows us to turn 2D art into 3D meshes in seconds, keeping the user in the "flow state."
4.  **Neural Renderer (FIBO):** The final loop sends the modified 3D scene back to Bria. Because FIBO respects input structure so well, it allows us to "re-skin" our rough 3D mockup in high quality without hallucinating new objects.

## Challenges we ran into

**Real-World Integration:** We wanted users to be able to paste an eBay link and see that item in the room.
*   **The Fix:** We used Gemini to extract semantic attributes from product pages, but the magic happened when we mapped those attributes to FIBO's specific JSON schema. The model's adherence to instruction meant the generated assets actually looked like the real-world products.

## Accomplishments that we're proud of
*   **Validating the "Code-as-Design" Paradigm:** We proved that when you give designers and developers access to a model like **FIBO** that speaks their language (JSON), you unlock capabilities that UI-based prompting can never achieve.
*   **The "Magic" 3D Handoff:** Watching a flat 2D image pop into a manipulatable 3D scene—powered by the speed of **fal.ai**—feels like magic every single time.
*   **Git for GenAI:** We successfully implemented a Git-style history (forking, diffing, restoring) for visual design. This is only possible because **Bria** treats image generation as structured data, not random noise.

## What we learned
*   Amazing new possibilities for better control in image generation models; JSON structured prompting is immensely interesting

## What's next for FIBOx3D Studio
*   **Collaborative Design:** Implementing a "Google Docs for 3D" feature where multiple users can edit the FIBO JSON state simultaneously.