// Centralized prompts with template interpolation

export const prompts = {
  analysis: ({ listDirective = "Analyze this room image and provide a list of ALL the major items visible in the room." } = {}) => (
    `${listDirective} Format your response as a numbered list with each item as: '**Item Name:** Description'. ` +
    `Your output must only contain the list without any other text. Merge similar items. Include ALL major items!`
  ),

  fiboBase: ({ itemsList, extra = "interior design render, realistic product photograph shoot." }) => (
    `Ensure you include all of these discrete objects!\n\n${itemsList}\n\n` +
    `${extra}`
  ),
  
  chatRefine: ({ userText }) => (
    `The following request has been made to update the scene. Reason carefully about it and if it is lacking in detail, fill it in as appropriate - unless the user has already been quite precise. For instance, if the user asked for generic living room furniture, reason about what makes sense to add and add separate objects. But if they explicitly asked for something precise like "make the bed blue", then of course you should just act on that. Don't change unrelated aspects of the scene. The request is: ${userText}`
  )
  ,
  addObject: ({ name, description }) => (
    `DO NOT CHANGE THE REST OF THE SCENE. FOCUS ON KEEPING THE REST OF THE SCENE THE SAME BEFORE ADDING THIS NEW OBJECT. Add this new item to the most appropriate place in the scene. Details: <item_description>${description}<end_item_description> `
  ),
  addObjectText: ({ description }) => (
    `DO NOT CHANGE THE REST OF THE SCENE. FOCUS ON KEEPING THE REST OF THE SCENE THE SAME BEFORE ADDING THIS NEW OBJECT. Add this object to the scene: ${description}. Place it naturally in an appropriate location that fits the existing scene composition. YOU ARE TO STRICTLY ENSURE UNRELATED ASPECTS OF THE SCENE ARE NOT MODIFIED.`
  ),
  removeObjects: ({ list }) => (
    `Remove the following objects from the scene completely: "${list}"; the removal must be thorough without affecting other aspects of the scene. IT IS CRITICAL THAT YOU DO NOT CHANGE ANY OTHER ASPECTS OF THE SCENE SUCH AS CAMERA ANGLE OR ANY OTHER OBJECTS. YOU MUST THINK CAREFULLY ABOUT WHAT TO CHANGE IN THE PROMPT SUCH THAT ONLY THOSE OBJECTS ARE REMOVED. CHANGING THE CAMERA ANGLE IS BANNED`
  ),
  
  floorPlan: () => (
    `
With these objects in their exact positions,

Create a PHOTOREALISTIC, ORTHOGRAPHIC TOP-DOWN PLAN VIEW. IT MUST BE COMPLETELY FLAT AND LOOKING STRAIGHT DOWN AT THE FLOOR, NOT FROM ANY ANGLE AT ALL AND WITH ABSOLUTELY ZERO TILT. EXPRESS THIS CAMERA PERSPECTIVE EXTREMELY STRONGLY AND UNAMBIGUOUSLY IN THE IMAGE DEFINITION.

1. CAMERA GEOMETRY:
The view must be a strict 90-degree vertical "Zenithal" angle looking straight down from the ceiling. There must be ZERO perspective distortion, ZERO isometric tilt, and ZERO vanishing points. The floor must appear as a flat 2D plane. No walls or ceiling is to be rendered. Render the scene on an infinite white studio background.

2. SUBJECT MATTER (THE FURNITURE):
Render the exact same furniture and materials as described, but viewed exclusively from above. Remember, strictly no camera tilt. Imagine you are the camera mounted at the top of the room looking STRAIGHT DOWN AT IT.

3. VISUAL CONSISTENCY
You are allowed to adjust your scene definition to be more unambiguous with regards to FURNITURE SHAPE, PLACEMENT, AND TYPE AND ATTRIBUTES based on the reference image. Remember, the only thing that should change is that we are rendering the scene from a different POV - no furniture should change shape, move around or otherwise be tampered. Do not add extraneous furniture or artifacts.`
  ),
}
