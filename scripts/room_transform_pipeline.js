const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.PL_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.PL_R2_ACCESS_KEY_ID, secretAccessKey: process.env.PL_R2_SECRET_ACCESS_KEY },
    forcePathStyle: true
  });
}

async function streamToBuffer(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_PHOTO_BYTES) throw new Error('Room photo exceeds 10MB processing limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function loadPhoto(order, dryRun) {
  if (dryRun && process.env.PL_TEST_PHOTO_PATH) {
    const testPath = path.resolve(process.env.PL_TEST_PHOTO_PATH);
    if (!fs.existsSync(testPath)) throw new Error('PL_TEST_PHOTO_PATH does not exist.');
    const ext = path.extname(testPath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
    return { bytes: fs.readFileSync(testPath), contentType };
  }
  if (!order.photo_key) throw new Error('$59 orders require a private R2 photo_key.');
  if (!order.photo_key.startsWith('uploads/room-photos/')) throw new Error('Photo key is outside the allowed upload prefix.');
  const result = await client().send(new GetObjectCommand({ Bucket: process.env.PL_R2_BUCKET_NAME, Key: order.photo_key }));
  const contentType = result.ContentType || 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('Unsupported room photo type.');
  return { bytes: await streamToBuffer(result.Body), contentType };
}

function localEnrichment(order) {
  const room = order.room_type.replace(/_/g, ' ');
  return {
    headline: `A photo-led spatial correction for your ${room}`,
    cards: [
      { label: 'Photo diagnosis', title: 'Primary friction', text: `The uploaded room will be audited against the ${order.pain} pressure selected in your quiz.` },
      { label: 'Correction target', title: 'Clear the movement hierarchy', text: 'Protect the main circulation line before adding furniture, storage, or decorative objects.' },
      { label: 'Persona response', title: `${order.persona} operating rule`, text: 'Keep one dominant spatial decision per activity and remove competing visual anchors.' },
      { label: 'Transformation brief', title: 'Preserve the room, correct the layout', text: 'The proposed image retains the room shell while testing a more disciplined zoning and furnishing arrangement.' }
    ],
    seven_day_plan: [
      'Photograph and measure the current circulation path.',
      'Remove loose objects from the dominant visual field.',
      'Consolidate storage into one controlled boundary.',
      'Build one dedicated single-activity corner.',
      'Correct furniture alignment and cable exposure.',
      'Layer task and perimeter lighting.',
      'Run the final fit-check before purchasing anything else.'
    ],
    observations: [
      { title: 'Primary circulation', problem: 'The main route is visually compressed by movable furniture.', behavioral_impact: 'Movement feels negotiated instead of intuitive.', action_plan: 'Open one continuous walking lane before adding new pieces.' },
      { title: 'Activity overlap', problem: 'Multiple activities compete for the same central surface.', behavioral_impact: 'Resetting the room between tasks adds daily friction.', action_plan: 'Assign one clear surface or zone to each repeated activity.' },
      { title: 'Visual hierarchy', problem: 'Several objects compete to become the room focal point.', behavioral_impact: 'The eye has no stable place to rest.', action_plan: 'Choose one anchor and reduce competing objects around it.' },
      { title: 'Storage boundary', problem: 'Frequently used objects do not share a controlled storage address.', behavioral_impact: 'Loose items repeatedly return to visible work surfaces.', action_plan: 'Consolidate daily-use storage along one room boundary.' },
      { title: 'Lighting layers', problem: 'General lighting is carrying tasks that need local light.', behavioral_impact: 'The room feels flat and less adaptable after dark.', action_plan: 'Add task lighting at the primary activity and soften the perimeter.' }
    ],
    visual_prompt: `Photorealistic transformation of the supplied ${room}; preserve architecture and camera position; correct ${order.pain} friction for a ${order.persona} persona.`
  };
}

async function openAiAudit(order, dataUrl) {
  const fallback = localEnrichment(order);
  const prompt = `Analyze this real room photo as an architectural space-planning expert. The customer profile is persona=${order.persona}, variant=${order.variant || 'base'}, room=${order.room_type}, size=${order.room_size}, occupancy=${order.occupancy}, pain=${order.pain}, pets=${order.pets}. Return only valid JSON with: headline (string), cards (exactly 4 objects with label,title,text), seven_day_plan (exactly 7 concrete strings), visual_prompt (string), observations (exactly 5 objects with title,problem,behavioral_impact,action_plan). Be specific to visible objects. Do not infer structural alterations or hidden dimensions. The visual_prompt must preserve walls, windows, doors, camera angle and room identity while correcting layout.`;
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0.25,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }] }]
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`OpenAI vision returned ${response.status}`);
  const payload = await response.json();
  const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
  if (!Array.isArray(parsed.cards) || parsed.cards.length < 4 || !Array.isArray(parsed.seven_day_plan) || parsed.seven_day_plan.length < 7 || !Array.isArray(parsed.observations) || parsed.observations.length !== 5) {
    throw new Error('OpenAI vision response did not match the required dossier schema.');
  }
  return { ...fallback, ...parsed, cards: parsed.cards.slice(0, 4), seven_day_plan: parsed.seven_day_plan.slice(0, 7), observations: parsed.observations.slice(0, 5) };
}

async function replicateTransform(dataUrl, prompt) {
  const editPrompt = `Make a minimal, targeted edit to this exact photograph; do not generate a new room. Keep the exact portrait frame, crop, camera position, lens perspective and composition. Keep walls, ceiling, windows, doors, built-in shelving, floor, the largest furniture anchor and room proportions pixel-aligned with the input. Do not rotate, zoom, reframe, widen, crop or convert the space into another room type. Preserve at least 85% of the visible scene. Remove people, laptops, loose cables and temporary tabletop clutter, then apply only conservative movable-furniture, storage and lighting corrections. ${prompt}`;
  const start = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
    method: 'POST',
    headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ input: { prompt: editPrompt, input_image: dataUrl, aspect_ratio: 'match_input_image', prompt_upsampling: false, output_format: 'jpg', safety_tolerance: 2 } }),
    signal: AbortSignal.timeout(65000)
  });
  if (!start.ok) throw new Error(`Replicate start returned ${start.status}`);
  let prediction = await start.json();
  for (let attempt = 0; !['succeeded', 'failed', 'canceled'].includes(prediction.status) && attempt < 45; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const poll = await fetch(prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` },
      signal: AbortSignal.timeout(10000)
    });
    if (poll.ok) prediction = await poll.json();
  }
  if (prediction.status !== 'succeeded') throw new Error(`Replicate prediction ${prediction.status || 'timed out'}: ${prediction.error || ''}`);
  const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  const imageResponse = await fetch(outputUrl, { signal: AbortSignal.timeout(30000) });
  if (!imageResponse.ok) throw new Error('Could not download transformed room image.');
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Transformed image has an invalid size.');
  return { bytes, predictionId: prediction.id };
}

async function validateTransform(beforeDataUrl, afterDataUrl) {
  const prompt = 'Compare the before and after room images. Return only JSON with same_room (boolean), camera_preserved (boolean), architecture_preserved (boolean), identity_score (integer 0-10), and reason (string). Movable furniture, people, clutter, decor and lighting may change. Walls, ceiling, windows, doors, built-ins, floor geometry, viewpoint and room proportions must remain recognizably the same. Set camera_preserved=true when the viewpoint is clearly the same despite a minor crop or small perspective shift. Score below 8 if a customer could reasonably think this is a different room.';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'text', text: 'BEFORE IMAGE' },
        { type: 'image_url', image_url: { url: beforeDataUrl, detail: 'high' } },
        { type: 'text', text: 'AFTER IMAGE' },
        { type: 'image_url', image_url: { url: afterDataUrl, detail: 'high' } }
      ] }]
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`OpenAI transform validation returned ${response.status}`);
  const payload = await response.json();
  const result = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
  const passed = result.same_room === true && result.camera_preserved === true && result.architecture_preserved === true && Number(result.identity_score) >= 8;
  return { ...result, passed };
}

async function runRoomTransformPipeline(order, workDir, dryRun) {
  fs.mkdirSync(workDir, { recursive: true });
  const uploadedPhoto = await loadPhoto(order, dryRun);
  const normalizedBytes = await sharp(uploadedPhoto.bytes).rotate().jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
  const originalPath = path.join(workDir, 'original.jpg');
  fs.writeFileSync(originalPath, normalizedBytes);
  const dataUrl = `data:image/jpeg;base64,${normalizedBytes.toString('base64')}`;

  const enrichment = dryRun ? localEnrichment(order) : await openAiAudit(order, dataUrl);
  const enrichmentPath = path.join(workDir, 'photo-analysis.json');

  let coverPath = originalPath;
  let predictionId = null;
  if (!dryRun) {
    let transformed = null;
    let validation = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      transformed = await replicateTransform(dataUrl, enrichment.visual_prompt + (attempt === 2 ? ' Make the edit more conservative than the first attempt; change fewer elements.' : ''));
      const afterDataUrl = `data:image/jpeg;base64,${transformed.bytes.toString('base64')}`;
      validation = await validateTransform(dataUrl, afterDataUrl);
      fs.writeFileSync(path.join(workDir, `room-transform-candidate-${attempt}.jpg`), transformed.bytes);
      fs.writeFileSync(path.join(workDir, `room-transform-validation-${attempt}.json`), JSON.stringify(validation, null, 2));
      if (validation.passed) break;
    }
    if (!validation || !validation.passed) {
      throw new Error(`Room transformation failed identity validation: ${validation?.reason || 'unknown reason'}`);
    }
    coverPath = path.join(workDir, 'room-transform.jpg');
    fs.writeFileSync(coverPath, transformed.bytes);
    predictionId = transformed.predictionId;
    enrichment.transform_validation = validation;
  }
  fs.writeFileSync(enrichmentPath, JSON.stringify(enrichment, null, 2));
  return { enrichment, enrichmentPath, originalPath, coverPath, predictionId };
}

module.exports = { runRoomTransformPipeline };
