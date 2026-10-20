// ---------------------------------------------------------------------------
// The gym: an exercise library written for someone who has never lifted, a set
// of ready-made plans, and the arithmetic of progressing on them.
//
// Pure data and pure functions, like goals.js — no React. The Gym tab, the
// workout player and the coach all read from here, so an exercise is described
// once and reads the same everywhere.
//
// Shapes
//   exercise  { id, name, equip, kind, perSide?, optionalLoad?, primary[], secondary[],
//               steps[], tip, alts[], aka[]?, inc? }
//     kind: "weight" logs kg × reps, "reps" logs reps only, "time" logs seconds.
//     optionalLoad: a "weight" move that is fine with no weight (kg left empty).
//   program   { id, name, tagline, level, days, minutes, weeks, equip, color, icon,
//               schedule, about[], workouts[] }
//   workout   { id: "A", name, focus, exercises: [{ ex, sets, reps | sec, rest }] }
//     reps is a number or a [low, high] range; sec replaces reps for timed holds.
//   session   { id, programId, programName, workoutId, workoutName, startedAt, date,
//               durMs, exercises: [{ ex, name, kind, sets: [{ kg?, reps?, sec? }] }],
//               feel?, note? } — only completed sets are stored.
// ---------------------------------------------------------------------------

export const MUSCLES = {
  chest: "Chest",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Abs",
  obliques: "Obliques",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  lats: "Lats",
  upperBack: "Upper back",
  lowerBack: "Lower back",
};

// The six groups people actually think in. `color` names a C token, read at
// render time so it survives an accent switch.
export const GROUPS = [
  { id: "legs", name: "Legs", color: "orange", muscles: ["quads", "hamstrings", "glutes", "calves"] },
  { id: "chest", name: "Chest", color: "blue", muscles: ["chest"] },
  { id: "back", name: "Back", color: "purple", muscles: ["lats", "upperBack", "lowerBack"] },
  { id: "shoulders", name: "Shoulders", color: "cyan", muscles: ["shoulders"] },
  { id: "arms", name: "Arms", color: "yellow", muscles: ["biceps", "triceps", "forearms"] },
  { id: "core", name: "Core", color: "good", muscles: ["abs", "obliques"] },
];

export const EQUIPMENT = {
  machine: { name: "Machine", icon: "machine" },
  cable: { name: "Cable", icon: "cable" },
  dumbbell: { name: "Dumbbells", icon: "dumbbell" },
  barbell: { name: "Barbell", icon: "barbell" },
  bodyweight: { name: "Bodyweight", icon: "body" },
};

// The smallest jump each kind of kit allows. "A bit heavier" is about 5% of
// the weight, rounded to that step — never less than one step.
const INC = { barbell: 2.5, dumbbell: 2, machine: 5, cable: 5, bodyweight: 2 };

const X = (id, name, equip, kind, primary, secondary, steps, tip, alts, more = {}) =>
  ({ id, name, equip, kind, primary, secondary, steps, tip, alts, ...more });

const LIST = [
  // ---- legs ----------------------------------------------------------------
  X("leg-press", "Leg press", "machine", "weight", ["quads", "glutes"], ["hamstrings"], [
    "Sit with your back and head flat against the pad. Put your feet in the middle of the platform, hip-width apart.",
    "Release the safety handles. Bend your knees and let the platform come down slowly until your knees are at about a right angle.",
    "Push through your whole foot to straighten your legs again. Stop just before your knees lock.",
  ], "Keep your lower back pressed into the seat. If it starts to lift, don't go as deep.",
  ["goblet-squat", "split-squat", "back-squat"], { aka: ["leg press machine", "seated leg press"] }),

  X("goblet-squat", "Goblet squat", "dumbbell", "weight", ["quads", "glutes"], ["abs"], [
    "Hold one dumbbell upright against your chest with both hands. Feet shoulder-width apart, toes turned out a little.",
    "Sit down between your heels, chest up, knees pointing the same way as your toes.",
    "Go as low as you can with a flat back, then push the floor away to stand up.",
  ], "At the bottom your elbows should sit just inside your knees — that keeps you upright.",
  ["leg-press", "back-squat", "bodyweight-squat"], { aka: ["dumbbell squat", "kettlebell squat", "goblet squats"] }),

  X("back-squat", "Barbell back squat", "barbell", "weight", ["quads", "glutes"], ["hamstrings", "lowerBack", "abs"], [
    "Set the bar in a rack at chest height. Step under so it rests across your upper back — not your neck — and stand up to lift it off.",
    "Take two steps back, feet shoulder-width apart. Take a big breath and tighten your stomach.",
    "Sit down and back until your thighs are at least level with your knees, then drive straight back up.",
  ], "Set the rack's safety bars just below your lowest point, so a missed rep can't trap you.",
  ["goblet-squat", "leg-press", "split-squat"], { aka: ["squat", "barbell squat", "back squats"] }),

  X("bodyweight-squat", "Bodyweight squat", "bodyweight", "reps", ["quads", "glutes"], [], [
    "Stand with feet shoulder-width apart, arms out in front of you for balance.",
    "Sit back and down as if onto a low chair, chest up, knees following your toes.",
    "Go as low as feels comfortable, then stand up and squeeze your glutes at the top.",
  ], "Too easy? Pause for two seconds at the bottom of every rep.",
  ["goblet-squat", "split-squat", "step-up"], { aka: ["air squat", "air squats", "bodyweight squats"] }),

  X("split-squat", "Split squat", "bodyweight", "weight", ["quads", "glutes"], ["hamstrings"], [
    "Stand in a long stride, one foot forward, back heel lifted. Hold a dumbbell in each hand if you're using them.",
    "Lower straight down until your back knee almost touches the floor.",
    "Push through your front foot to come back up. Do all your reps, then switch legs.",
  ], "Keep your body upright and most of your weight on the front foot.",
  ["reverse-lunge", "step-up", "goblet-squat"], { perSide: true, optionalLoad: true, inc: 2, aka: ["static lunge", "dumbbell split squat", "bulgarian split squat"] }),

  X("reverse-lunge", "Reverse lunge", "bodyweight", "weight", ["quads", "glutes"], ["hamstrings"], [
    "Stand tall, feet hip-width apart. Hold dumbbells at your sides for extra challenge.",
    "Take a big step backwards and lower until your back knee nearly touches the floor.",
    "Push through your front heel to step back to standing. Do all reps on one leg, then switch.",
  ], "Stepping backwards is kinder to your knees than stepping forwards.",
  ["split-squat", "step-up", "goblet-squat"], { perSide: true, optionalLoad: true, inc: 2, aka: ["lunge", "lunges", "backward lunge", "dumbbell lunge"] }),

  X("step-up", "Step-up", "bodyweight", "weight", ["quads", "glutes"], [], [
    "Stand facing a sturdy box or bench about knee height. Hold dumbbells at your sides if you're using them.",
    "Put one whole foot on the box and push through that heel to stand up on it.",
    "Step back down slowly with the other foot. Do all reps on one leg, then switch.",
  ], "Let the top leg do the work — don't push off the floor with the back foot.",
  ["split-squat", "reverse-lunge", "leg-press"], { perSide: true, optionalLoad: true, inc: 2, aka: ["box step up", "dumbbell step up", "step ups"] }),

  X("db-rdl", "Dumbbell Romanian deadlift", "dumbbell", "weight", ["hamstrings", "glutes"], ["lowerBack"], [
    "Stand tall holding a dumbbell in each hand in front of your thighs, knees slightly bent.",
    "Push your hips back and let the dumbbells slide down your legs, back flat.",
    "When you feel a strong stretch in the back of your legs (around mid-shin), squeeze your glutes and stand up.",
  ], "Think \"hips back\", not \"bend over\". Your knees hardly bend more than at the start.",
  ["rdl", "single-leg-rdl", "leg-curl"], { aka: ["dumbbell rdl", "db rdl", "dumbbell romanian deadlift", "stiff leg deadlift"] }),

  X("rdl", "Barbell Romanian deadlift", "barbell", "weight", ["hamstrings", "glutes"], ["lowerBack", "forearms"], [
    "Hold a barbell at hip height, hands just outside your legs, knees soft.",
    "Push your hips back and slide the bar down your thighs, back flat and the bar close to your legs.",
    "Stop when the backs of your legs are fully stretched (usually just below the knee), then drive your hips forward to stand tall.",
  ], "Keep the bar touching your legs the whole way — if it drifts forward, your lower back takes over.",
  ["db-rdl", "deadlift", "hip-thrust"], { aka: ["romanian deadlift", "barbell rdl", "rdl"] }),

  X("deadlift", "Deadlift", "barbell", "weight", ["glutes", "hamstrings", "lowerBack"], ["quads", "upperBack", "forearms"], [
    "Stand with the bar over the middle of your feet. Bend down and grip it just outside your knees.",
    "Drop your hips until your shins touch the bar, chest up, back flat. Breathe in and brace your stomach.",
    "Push the floor away and stand up tall, bar against your legs. Lower it the same way, under control.",
  ], "Your back stays flat from start to finish. If it rounds, the weight is too heavy.",
  ["rdl", "db-rdl", "hip-thrust"], { aka: ["conventional deadlift", "barbell deadlift", "deadlifts"] }),

  X("single-leg-rdl", "Single-leg Romanian deadlift", "dumbbell", "weight", ["hamstrings", "glutes"], ["abs"], [
    "Stand on one leg with a slight bend in the knee, a dumbbell in the opposite hand.",
    "Tip forward from your hips while your free leg reaches straight back, until your body is nearly level with the floor.",
    "Squeeze the glute of your standing leg to come back up. Finish all reps, then switch sides.",
  ], "Wobbly? Lightly touch a wall or bench with your free hand. Balance improves fast.",
  ["db-rdl", "step-up", "glute-bridge"], { perSide: true, aka: ["single leg rdl", "one leg deadlift", "single-leg deadlift"] }),

  X("hip-thrust", "Hip thrust", "barbell", "weight", ["glutes"], ["hamstrings"], [
    "Sit on the floor with your upper back against a bench and a padded barbell across your hips, knees bent, feet flat.",
    "Push through your heels to lift your hips until your body is flat from shoulders to knees.",
    "Squeeze your glutes hard for a second at the top, then lower slowly.",
  ], "Tuck your chin and look forward, not at the ceiling — it stops your back arching.",
  ["glute-bridge", "rdl", "db-rdl"], { aka: ["barbell hip thrust", "glute thrust", "hip thrusts"] }),

  X("glute-bridge", "Glute bridge", "bodyweight", "weight", ["glutes"], ["hamstrings", "abs"], [
    "Lie on your back, knees bent, feet flat and hip-width apart. Rest a dumbbell on your hips for more challenge.",
    "Push through your heels and lift your hips until your body is straight from shoulders to knees.",
    "Squeeze your glutes at the top for a second, then lower slowly.",
  ], "Feel it in your lower back? Tuck your ribs down and squeeze your glutes harder.",
  ["hip-thrust", "single-leg-rdl", "superman"], { optionalLoad: true, inc: 2, aka: ["bridge", "hip bridge", "glute bridges"] }),

  X("leg-curl", "Leg curl", "machine", "weight", ["hamstrings"], ["calves"], [
    "Set the machine so the pad sits just above your heels and your knees line up with the machine's pivot.",
    "Curl your heels towards your bum as far as you can.",
    "Lower the weight slowly — take about two seconds on the way back.",
  ], "Keep your hips down on the pad; if they lift, the weight is too heavy.",
  ["db-rdl", "single-leg-rdl", "glute-bridge"], { aka: ["hamstring curl", "lying leg curl", "seated leg curl", "leg curls"] }),

  X("leg-extension", "Leg extension", "machine", "weight", ["quads"], [], [
    "Sit with your back against the pad and the roller on your lower shins. Line your knees up with the machine's pivot.",
    "Straighten your legs to lift the weight, and squeeze your thighs at the top.",
    "Lower slowly without letting the weights crash.",
  ], "Hold the handles to keep your hips down in the seat.",
  ["goblet-squat", "split-squat", "leg-press"], { aka: ["quad extension", "leg extensions"] }),

  X("calf-raise", "Calf raise", "bodyweight", "weight", ["calves"], [], [
    "Stand with the balls of your feet on the edge of a step, heels hanging off. Hold something for balance.",
    "Rise up onto your toes as high as you can and pause for a second.",
    "Lower your heels slowly below the step until you feel a stretch, then go again.",
  ], "Slow and full range beats bouncing. For more, hold a dumbbell, use the calf machine or do one leg at a time.",
  ["step-up"], { optionalLoad: true, inc: 2, aka: ["standing calf raise", "calf raises", "calf raise machine", "seated calf raise"] }),

  // ---- chest & shoulders ----------------------------------------------------
  X("chest-press", "Chest press machine", "machine", "weight", ["chest"], ["triceps", "shoulders"], [
    "Adjust the seat so the handles are level with the middle of your chest. Sit with your back flat against the pad.",
    "Push the handles forward until your arms are straight but not locked.",
    "Let them come back slowly until your hands are just in front of your chest.",
  ], "Keep your shoulder blades pulled back against the pad the whole time.",
  ["db-bench-press", "push-up", "bench-press"], { aka: ["machine chest press", "seated chest press", "chest press"] }),

  X("db-bench-press", "Dumbbell bench press", "dumbbell", "weight", ["chest"], ["triceps", "shoulders"], [
    "Sit on a flat bench with the dumbbells on your knees, then lie back and bring them up over your chest.",
    "Lower the dumbbells slowly to the sides of your chest, elbows at about 45° from your body.",
    "Press them back up until your arms are straight above your chest.",
  ], "Feet flat on the floor and shoulder blades squeezed together — that's your stable base.",
  ["chest-press", "bench-press", "push-up"], { aka: ["dumbbell press", "db bench", "dumbbell chest press", "flat dumbbell press", "dumbbell bench"] }),

  X("bench-press", "Barbell bench press", "barbell", "weight", ["chest"], ["triceps", "shoulders"], [
    "Lie on the bench with your eyes under the bar. Grip it a little wider than shoulder-width, feet flat on the floor.",
    "Lift the bar off the rack and lower it slowly to the middle of your chest.",
    "Press it back up until your arms are straight, then rack it.",
  ], "Use a rack with safety arms, or ask someone to spot you, once the weight gets heavy.",
  ["db-bench-press", "chest-press", "push-up"], { aka: ["bench", "barbell bench", "flat bench press", "bench press"] }),

  X("incline-db-press", "Incline dumbbell press", "dumbbell", "weight", ["chest", "shoulders"], ["triceps"], [
    "Set a bench to a slight incline (about 30°). Sit back with a dumbbell in each hand at shoulder height.",
    "Press the dumbbells up until your arms are straight above your upper chest.",
    "Lower them slowly back to your shoulders.",
  ], "A low incline works the upper chest; a steep one turns it into a shoulder press.",
  ["db-bench-press", "chest-press", "db-shoulder-press"], { aka: ["incline press", "incline dumbbell bench", "incline bench press"] }),

  X("push-up", "Push-up", "bodyweight", "reps", ["chest"], ["triceps", "shoulders", "abs"], [
    "Hands on the floor a bit wider than your shoulders, body straight from head to heels.",
    "Bend your elbows to lower your chest towards the floor, elbows angled back rather than flared out.",
    "Push the floor away to straighten your arms again.",
  ], "Too hard? Put your hands on a bench or a wall. The higher your hands, the easier it gets.",
  ["chest-press", "db-bench-press", "incline-db-press"], { aka: ["pushup", "pushups", "press up", "press-up", "push ups"] }),

  X("db-shoulder-press", "Dumbbell shoulder press", "dumbbell", "weight", ["shoulders"], ["triceps"], [
    "Sit on a bench with back support. Hold a dumbbell in each hand at shoulder height, palms facing forward.",
    "Press the dumbbells straight up until your arms are almost straight.",
    "Lower them slowly back to your shoulders.",
  ], "Keep your back against the pad — don't lean back to get the weight up.",
  ["overhead-press", "incline-db-press", "lateral-raise"], { aka: ["shoulder press", "seated dumbbell press", "dumbbell overhead press", "seated shoulder press"] }),

  X("overhead-press", "Overhead press", "barbell", "weight", ["shoulders"], ["triceps", "abs"], [
    "Take the bar from a rack at collarbone height, hands just outside your shoulders, feet hip-width apart.",
    "Squeeze your glutes and stomach, then press the bar straight up, moving your head back a little so it passes your chin.",
    "Finish with the bar straight over your head, then lower it back to your collarbones.",
  ], "Don't lean back or arch your lower back — squeezing your glutes keeps you straight.",
  ["db-shoulder-press", "incline-db-press"], { aka: ["ohp", "military press", "standing press", "barbell shoulder press"] }),

  X("lateral-raise", "Lateral raise", "dumbbell", "weight", ["shoulders"], [], [
    "Stand tall holding light dumbbells at your sides, a slight bend in your elbows.",
    "Raise your arms out to the sides until your hands reach shoulder height.",
    "Lower them slowly — the way down counts as much as the way up.",
  ], "Go light. Lead with your elbows and imagine pushing the weights out to the walls, not up.",
  ["db-shoulder-press", "face-pull"], { inc: 1, aka: ["side raise", "lateral raises", "dumbbell lateral raise", "side lateral raise"] }),

  // ---- back -----------------------------------------------------------------
  X("lat-pulldown", "Lat pulldown", "cable", "weight", ["lats"], ["biceps", "upperBack"], [
    "Sit with your thighs under the pads and grip the bar a little wider than your shoulders.",
    "Lean back slightly and pull the bar down to your upper chest, driving your elbows down to your sides.",
    "Let the bar rise slowly until your arms are straight again.",
  ], "Pull with your elbows, not your hands — you'll feel your back working instead of your arms.",
  ["pull-up", "seated-row", "db-row"], { aka: ["pulldown", "lat pull down", "wide grip pulldown", "lat pulldowns"] }),

  X("seated-row", "Seated cable row", "cable", "weight", ["upperBack", "lats"], ["biceps"], [
    "Sit with your feet on the platform, knees slightly bent, holding the handle with straight arms.",
    "Sit tall and pull the handle to your stomach, squeezing your shoulder blades together.",
    "Let your arms straighten slowly, feeling your back stretch, without rounding forward.",
  ], "Your body stays still — no rocking back and forth to move the weight.",
  ["db-row", "lat-pulldown", "barbell-row"], { aka: ["cable row", "seated row", "low row", "machine row"] }),

  X("db-row", "One-arm dumbbell row", "dumbbell", "weight", ["lats", "upperBack"], ["biceps"], [
    "Put one knee and the same hand on a bench, back flat. Hold a dumbbell in the other hand, arm straight.",
    "Pull the dumbbell up towards your hip, elbow close to your body.",
    "Lower it slowly until your arm is straight. Do all reps, then switch sides.",
  ], "Imagine sliding the dumbbell into your back pocket — it keeps the pull in your back, not your arm.",
  ["seated-row", "barbell-row", "inverted-row"], { perSide: true, aka: ["dumbbell row", "single arm row", "one arm row", "db row", "single-arm dumbbell row"] }),

  X("barbell-row", "Barbell row", "barbell", "weight", ["upperBack", "lats"], ["biceps", "lowerBack"], [
    "Hold the bar with hands just wider than your knees. Push your hips back and lean forward until your chest faces the floor, back flat.",
    "Pull the bar to your lower ribs, driving your elbows back.",
    "Lower it under control until your arms are straight.",
  ], "If you have to jerk your body up to move the bar, take some weight off.",
  ["db-row", "seated-row", "inverted-row"], { aka: ["bent over row", "bent-over row", "pendlay row", "barbell rows"] }),

  X("pull-up", "Pull-up", "bodyweight", "reps", ["lats"], ["biceps", "upperBack"], [
    "Hang from a bar with your hands just wider than your shoulders, palms facing away.",
    "Pull yourself up until your chin is over the bar, driving your elbows down.",
    "Lower yourself slowly until your arms are straight again.",
  ], "Can't do one yet? Use the assisted pull-up machine or a resistance band — or swap in lat pulldowns.",
  ["lat-pulldown", "inverted-row"], { aka: ["pullup", "pull ups", "chin up", "chin-up", "assisted pull-up", "chin ups"] }),

  X("inverted-row", "Inverted row", "bodyweight", "reps", ["upperBack", "lats"], ["biceps", "abs"], [
    "Lie under a bar fixed at waist height (a Smith machine or a squat rack works) and grab it, hands shoulder-width apart.",
    "Keep your body straight from heels to head and pull your chest up to the bar.",
    "Lower yourself slowly until your arms are straight.",
  ], "The more upright your body, the easier it is. Bend your knees to make it easier still.",
  ["db-row", "seated-row", "lat-pulldown"], { aka: ["bodyweight row", "australian pull up", "body row", "ring row"] }),

  X("face-pull", "Face pull", "cable", "weight", ["shoulders", "upperBack"], [], [
    "Set a rope on a cable at face height. Hold the ends with your thumbs pointing back at you and step back until your arms are straight.",
    "Pull the rope towards your forehead, pulling the ends apart and your elbows out wide and high.",
    "Hold for a second, then let it go back slowly.",
  ], "Light weight and a pause at the end — this one is for posture and healthy shoulders, not heavy lifting.",
  ["reverse-fly", "seated-row"], { aka: ["facepull", "rope face pull", "face pulls"] }),

  X("reverse-fly", "Reverse fly", "dumbbell", "weight", ["upperBack", "shoulders"], [], [
    "Hold light dumbbells and lean forward from your hips until your chest faces the floor, back flat.",
    "With a slight bend in your elbows, raise your arms out to the sides until they're level with your body.",
    "Squeeze your shoulder blades together at the top, then lower slowly.",
  ], "Use light weights — the muscles at the back of your shoulders are small.",
  ["face-pull", "db-row"], { inc: 1, aka: ["rear delt fly", "reverse flye", "bent over fly", "rear delt raise"] }),

  // ---- arms ----------------------------------------------------------------
  X("db-curl", "Dumbbell curl", "dumbbell", "weight", ["biceps"], ["forearms"], [
    "Stand tall with a dumbbell in each hand, arms straight, palms facing forward.",
    "Curl the dumbbells up towards your shoulders, elbows staying by your sides.",
    "Lower them slowly all the way down.",
  ], "No swinging — if your back has to help, it's too heavy.",
  ["hammer-curl"], { inc: 1, aka: ["bicep curl", "biceps curl", "curls", "dumbbell bicep curl", "bicep curls"] }),

  X("hammer-curl", "Hammer curl", "dumbbell", "weight", ["biceps", "forearms"], [], [
    "Stand with a dumbbell in each hand, palms facing your body.",
    "Curl the dumbbells up with your palms still facing in, elbows by your sides.",
    "Lower them slowly.",
  ], "Good for your forearms and grip as well as your biceps.",
  ["db-curl"], { inc: 1, aka: ["hammer curls", "neutral grip curl"] }),

  X("triceps-pushdown", "Triceps pushdown", "cable", "weight", ["triceps"], [], [
    "Attach a rope or a short bar to a high cable. Stand close, elbows tucked in at your sides.",
    "Push the handle down until your arms are straight, squeezing the backs of your arms.",
    "Let it come back up slowly until your forearms are just above level with the floor.",
  ], "Your elbows stay glued to your sides — only your forearms move.",
  ["overhead-triceps", "push-up"], { aka: ["tricep pushdown", "cable pushdown", "rope pushdown", "triceps pushdowns"] }),

  X("overhead-triceps", "Overhead triceps extension", "dumbbell", "weight", ["triceps"], [], [
    "Sit or stand holding one dumbbell with both hands, arms straight above your head.",
    "Bend your elbows to lower the dumbbell behind your head.",
    "Straighten your arms to lift it back up, elbows pointing forward.",
  ], "Keep your elbows close to your head and your ribs down.",
  ["triceps-pushdown", "push-up"], { inc: 1, aka: ["overhead extension", "tricep extension", "triceps extension", "french press"] }),

  // ---- core ----------------------------------------------------------------
  X("plank", "Plank", "bodyweight", "time", ["abs"], ["obliques", "shoulders"], [
    "Rest on your forearms and toes, elbows under your shoulders.",
    "Make a straight line from head to heels — squeeze your glutes and tighten your stomach.",
    "Hold the position and keep breathing.",
  ], "Hips sagging or poking up means it's time to stop. Good form beats a long time.",
  ["dead-bug", "side-plank", "bird-dog"], { aka: ["front plank", "forearm plank", "plank hold", "planks"] }),

  X("side-plank", "Side plank", "bodyweight", "time", ["obliques"], ["abs", "shoulders", "glutes"], [
    "Lie on your side, propped up on one forearm with the elbow under your shoulder, legs stacked.",
    "Lift your hips so your body makes a straight line from head to feet.",
    "Hold, then switch sides.",
  ], "Easier: bend your knees and balance on them instead of your feet.",
  ["plank", "pallof-press"], { perSide: true, aka: ["side planks"] }),

  X("dead-bug", "Dead bug", "bodyweight", "reps", ["abs"], ["obliques"], [
    "Lie on your back, arms pointing at the ceiling, knees bent at 90° above your hips.",
    "Press your lower back into the floor, then slowly lower your right arm and left leg towards the floor.",
    "Bring them back and repeat with the other arm and leg. Each side counts as one rep.",
  ], "Move slowly. If your lower back lifts off the floor, don't lower your arm and leg as far.",
  ["plank", "bird-dog"], { perSide: true, aka: ["deadbug", "dead bugs"] }),

  X("bird-dog", "Bird dog", "bodyweight", "reps", ["abs", "lowerBack"], ["glutes", "shoulders"], [
    "Start on your hands and knees, hands under your shoulders and knees under your hips.",
    "Reach one arm forward and the opposite leg back until both are level with your body.",
    "Hold for two seconds, come back, and switch sides.",
  ], "Imagine a glass of water balanced on your lower back — don't spill it.",
  ["dead-bug", "superman", "plank"], { perSide: true, aka: ["bird dogs", "quadruped arm leg raise"] }),

  X("pallof-press", "Pallof press", "cable", "weight", ["obliques", "abs"], [], [
    "Set a cable handle at chest height. Stand side-on to the machine, holding the handle against your chest with both hands.",
    "Step away until you feel tension, then press the handle straight out in front of you.",
    "Hold for two seconds without letting the cable twist you, then bring it back. Do all reps, then face the other way.",
  ], "This trains your core to resist twisting — exactly what it does on every running stride.",
  ["side-plank", "dead-bug"], { perSide: true, aka: ["pallof", "anti rotation press", "pallof presses"] }),

  X("hanging-knee-raise", "Hanging knee raise", "bodyweight", "reps", ["abs"], ["forearms", "obliques"], [
    "Hang from a pull-up bar with straight arms (or use the knee-raise station, back against the pad).",
    "Bring your knees up towards your chest by curling your hips up.",
    "Lower your legs slowly without swinging.",
  ], "Start by tilting your hips — that's what makes it an ab exercise, not just a leg lift.",
  ["dead-bug", "plank"], { aka: ["knee raise", "knee raises", "leg raise", "hanging leg raise", "captains chair"] }),

  X("superman", "Superman", "bodyweight", "reps", ["lowerBack", "glutes"], ["upperBack"], [
    "Lie face down with your arms stretched out in front of you.",
    "Lift your arms, chest and legs a few centimetres off the floor at the same time.",
    "Hold for two seconds, then lower slowly.",
  ], "Keep looking at the floor so your neck stays relaxed.",
  ["bird-dog", "glute-bridge"], { aka: ["back extension", "supermans", "prone extension", "back extensions"] }),
];

export const EXERCISES = Object.fromEntries(LIST.map((x) => [x.id, x]));
export const exerciseList = () => LIST;

export const groupOf = (ex) => {
  const m = ex && ex.primary && ex.primary[0];
  return GROUPS.find((g) => g.muscles.includes(m)) || GROUPS[0];
};

export const muscleNames = (ex, max = 3) =>
  ex ? [...ex.primary, ...ex.secondary].slice(0, max).map((m) => MUSCLES[m]).join(" · ") : "";

// ---------------------------------------------------------------------------
// Ready-made plans. Workouts rotate — A, B, A, B… — one per gym visit, so the
// app can always answer "what do I do today?" without a calendar.
// ---------------------------------------------------------------------------
const W = (ex, sets, reps, rest) => (typeof reps === "string" && reps.endsWith("s")
  ? { ex, sets, sec: parseInt(reps, 10), rest }
  : { ex, sets, reps, rest });

export const PROGRAMS = [
  {
    id: "starter", name: "Gym starter", tagline: "Never trained in a gym? Start here.",
    level: "Beginner", days: 3, minutes: 45, weeks: 6, equip: "Machines + dumbbells",
    color: "good", icon: "machine", schedule: "Mon · Wed · Fri",
    about: [
      "Two workouts, A and B. Do one each time you go and alternate them — A, B, A this week, then B, A, B the next.",
      "Leave a rest day between workouts. Monday, Wednesday and Friday is the classic.",
      "Mostly machines: they guide the movement, so you can learn safely and just focus on the effort.",
      "Pick weights you could lift two or three more times at the end of each set. Hit the top of the rep range on every set and Stride tells you to go a little heavier next time.",
    ],
    workouts: [
      { id: "A", name: "Workout A", focus: "Legs · chest · back", exercises: [
        W("leg-press", 3, [10, 12], 90), W("chest-press", 3, [10, 12], 90), W("lat-pulldown", 3, [10, 12], 90),
        W("leg-curl", 2, [12, 15], 60), W("triceps-pushdown", 2, [12, 15], 60), W("plank", 3, "30s", 45),
      ] },
      { id: "B", name: "Workout B", focus: "Legs · back · shoulders", exercises: [
        W("goblet-squat", 3, [10, 12], 90), W("seated-row", 3, [10, 12], 90), W("db-shoulder-press", 3, [10, 12], 90),
        W("db-rdl", 3, [10, 12], 90), W("db-curl", 2, [12, 15], 60), W("dead-bug", 2, 8, 45),
      ] },
    ],
  },
  {
    id: "dumbbell", name: "Dumbbell full body", tagline: "All you need is a pair of dumbbells and a bench.",
    level: "Beginner", days: 3, minutes: 45, weeks: 6, equip: "Dumbbells + a bench",
    color: "blue", icon: "dumbbell", schedule: "Mon · Wed · Fri",
    about: [
      "Two full-body workouts, A and B, alternated three times a week.",
      "Ideal for a busy gym where the machines are always taken, or for training at home.",
      "Most moves use the same pair of dumbbells, so there's little waiting around between sets.",
    ],
    workouts: [
      { id: "A", name: "Workout A", focus: "Squat · press · row", exercises: [
        W("goblet-squat", 3, [10, 12], 90), W("db-bench-press", 3, [8, 12], 90), W("db-row", 3, [10, 12], 60),
        W("db-rdl", 3, [10, 12], 90), W("lateral-raise", 2, [12, 15], 60), W("plank", 3, "30s", 45),
      ] },
      { id: "B", name: "Workout B", focus: "Lunge · press · pull", exercises: [
        W("split-squat", 3, [8, 10], 60), W("db-shoulder-press", 3, [8, 12], 90), W("push-up", 3, [8, 12], 60),
        W("glute-bridge", 3, [12, 15], 60), W("reverse-fly", 2, [12, 15], 60), W("hammer-curl", 2, [10, 12], 60),
        W("side-plank", 2, "20s", 30),
      ] },
    ],
  },
  {
    id: "runner", name: "Runner's strength", tagline: "Stronger legs and core, fewer niggles, easier kilometres.",
    level: "Beginner", days: 2, minutes: 40, weeks: 8, equip: "Dumbbells + a bench",
    color: "accent", icon: "run", schedule: "Tue · Fri",
    about: [
      "Two short sessions a week that make running feel easier: single-leg strength, glutes, calves and core.",
      "Do them after an easy run or on a rest day — never the day before a long run or a hard session.",
      "Go steady. The goal is strength without being too sore to run, so leave two reps in the tank on every set.",
    ],
    workouts: [
      { id: "A", name: "Strength A", focus: "Squat · hinge · calves", exercises: [
        W("goblet-squat", 3, [8, 10], 90), W("single-leg-rdl", 3, 8, 60), W("step-up", 3, 8, 60),
        W("calf-raise", 3, [12, 15], 45), W("dead-bug", 2, 8, 45), W("side-plank", 2, "30s", 30),
      ] },
      { id: "B", name: "Strength B", focus: "Lunge · glutes · core", exercises: [
        W("reverse-lunge", 3, 8, 60), W("db-rdl", 3, [8, 10], 90), W("glute-bridge", 3, 12, 60),
        W("calf-raise", 3, 15, 45), W("pallof-press", 2, 10, 45), W("bird-dog", 2, 8, 30),
      ] },
    ],
  },
  {
    id: "bodyweight", name: "No equipment", tagline: "No gym, no problem — train anywhere.",
    level: "Beginner", days: 3, minutes: 35, weeks: 4, equip: "No equipment",
    color: "orange", icon: "body", schedule: "Mon · Wed · Fri",
    about: [
      "Two workouts that use only your body weight, alternated three times a week.",
      "Make any exercise harder by slowing it down: three seconds on the way down.",
      "Step-ups need a sturdy step or bench, and inverted rows a sturdy bar — skip them if you have neither.",
    ],
    workouts: [
      { id: "A", name: "Workout A", focus: "Squat · push · core", exercises: [
        W("bodyweight-squat", 3, [12, 15], 60), W("push-up", 3, [6, 12], 60), W("glute-bridge", 3, [12, 15], 45),
        W("reverse-lunge", 2, [8, 10], 45), W("superman", 2, 10, 30), W("plank", 3, "30s", 30),
      ] },
      { id: "B", name: "Workout B", focus: "Lunge · pull · core", exercises: [
        W("split-squat", 3, [8, 10], 45), W("inverted-row", 3, [6, 10], 60), W("step-up", 3, 10, 45),
        W("push-up", 2, [6, 12], 60), W("dead-bug", 2, 8, 30), W("side-plank", 2, "20s", 30),
      ] },
    ],
  },
  {
    id: "upperlower", name: "Upper / lower", tagline: "Four days and the big barbell lifts, for steady gains.",
    level: "Intermediate", days: 4, minutes: 55, weeks: 8, equip: "Full gym",
    color: "purple", icon: "barbell", schedule: "Mon · Tue · Thu · Fri",
    about: [
      "Four workouts in a cycle — Upper A, Lower A, Upper B, Lower B — one per visit.",
      "Each session opens with a heavy barbell lift while you're fresh, then the lighter work.",
      "For when you know your way around the gym and want to get properly strong.",
    ],
    workouts: [
      { id: "A", name: "Upper A", focus: "Bench · row · press", exercises: [
        W("bench-press", 4, [6, 8], 150), W("barbell-row", 4, [6, 8], 120), W("overhead-press", 3, [8, 10], 120),
        W("lat-pulldown", 3, [10, 12], 90), W("db-curl", 2, [10, 12], 60), W("triceps-pushdown", 2, [10, 12], 60),
      ] },
      { id: "B", name: "Lower A", focus: "Squat · hinge", exercises: [
        W("back-squat", 4, [6, 8], 150), W("rdl", 3, [8, 10], 120), W("leg-press", 3, [10, 12], 90),
        W("leg-curl", 3, [10, 12], 60), W("calf-raise", 3, [12, 15], 60), W("plank", 3, "40s", 45),
      ] },
      { id: "C", name: "Upper B", focus: "Incline · pull-up · shoulders", exercises: [
        W("incline-db-press", 4, [8, 10], 120), W("pull-up", 4, [6, 10], 120), W("seated-row", 3, [10, 12], 90),
        W("lateral-raise", 3, [12, 15], 60), W("face-pull", 3, [12, 15], 60), W("hammer-curl", 2, [10, 12], 60),
      ] },
      { id: "D", name: "Lower B", focus: "Deadlift · single leg", exercises: [
        W("deadlift", 3, 5, 180), W("split-squat", 3, [8, 10], 90), W("hip-thrust", 3, [8, 12], 90),
        W("leg-extension", 3, [12, 15], 60), W("calf-raise", 3, [12, 15], 60), W("hanging-knee-raise", 3, [10, 12], 60),
      ] },
    ],
  },
  {
    id: "ppl", name: "Push / pull / legs", tagline: "Each muscle group gets a day of its own.",
    level: "Intermediate", days: 3, minutes: 55, weeks: 8, equip: "Full gym",
    color: "pink", icon: "flame", schedule: "Mon · Wed · Fri",
    about: [
      "Three workouts in a cycle: push (chest, shoulders, triceps), pull (back, biceps) and legs.",
      "Three days a week covers everything once; experienced lifters can run the cycle twice a week.",
      "Each day opens with a heavy compound lift — rest a full two to three minutes between those sets.",
    ],
    workouts: [
      { id: "A", name: "Push", focus: "Chest · shoulders · triceps", exercises: [
        W("bench-press", 4, [6, 8], 150), W("overhead-press", 3, [8, 10], 120), W("incline-db-press", 3, [8, 12], 90),
        W("lateral-raise", 3, [12, 15], 60), W("triceps-pushdown", 3, [10, 12], 60), W("overhead-triceps", 2, [10, 12], 60),
      ] },
      { id: "B", name: "Pull", focus: "Back · biceps", exercises: [
        W("pull-up", 4, [6, 10], 120), W("barbell-row", 4, [6, 8], 120), W("lat-pulldown", 3, [10, 12], 90),
        W("face-pull", 3, [12, 15], 60), W("db-curl", 3, [10, 12], 60), W("hammer-curl", 2, [10, 12], 60),
      ] },
      { id: "C", name: "Legs", focus: "Quads · hamstrings · glutes", exercises: [
        W("back-squat", 4, [6, 8], 150), W("rdl", 3, [8, 10], 120), W("leg-press", 3, [10, 12], 90),
        W("leg-curl", 3, [10, 12], 60), W("calf-raise", 4, [12, 15], 60), W("hanging-knee-raise", 3, [10, 12], 60),
      ] },
    ],
  },
];

export const programById = (id) => PROGRAMS.find((p) => p.id === id) || null;

export const WARMUP = "Warm up first: 5 minutes easy on a bike, rower or treadmill, then one light set of your first exercise.";

// ---------------------------------------------------------------------------
// Targets and formatting
// ---------------------------------------------------------------------------

export const repRange = (t) => {
  if (Array.isArray(t.reps)) return [t.reps[0], t.reps[1]];
  const n = Number(t.reps) || 10;
  return [n, n];
};

// "3 × 10–12", "3 × 8 / side", "3 × 30 s"
export function targetLabel(t, ex = EXERCISES[t.ex]) {
  const per = ex && ex.perSide ? " / side" : "";
  if (ex && ex.kind === "time") return `${t.sets} × ${t.sec || 30} s${per}`;
  const [lo, hi] = repRange(t);
  return `${t.sets} × ${lo === hi ? lo : `${lo}–${hi}`}${per}`;
}

export const restLabel = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} rest` : `${sec} s rest`);

// About how long a workout takes: work + rest per set, a minute to set up each
// exercise, five minutes of warm-up. Rounded to five so it reads as a guide.
export function workoutMinutes(workout) {
  let sec = 300;
  for (const t of workout.exercises) {
    const ex = EXERCISES[t.ex];
    const work = ex && ex.kind === "time" ? (t.sec || 30) * (ex.perSide ? 2 : 1) : (ex && ex.perSide ? 70 : 40);
    sec += 60 + t.sets * (work + (t.rest || 90));
  }
  return Math.max(10, Math.round(sec / 300) * 5);
}

export const workoutSets = (workout) => workout.exercises.reduce((n, t) => n + (t.sets || 0), 0);

// Every muscle a workout trains: primary wherever any exercise leads with it.
export function workoutMuscles(workout) {
  const primary = new Set(), secondary = new Set();
  for (const t of workout.exercises) {
    const ex = EXERCISES[t.ex];
    if (!ex) continue;
    ex.primary.forEach((m) => primary.add(m));
    ex.secondary.forEach((m) => secondary.add(m));
  }
  primary.forEach((m) => secondary.delete(m));
  return { primary: [...primary], secondary: [...secondary] };
}

// ---------------------------------------------------------------------------
// History: what was done last time, best sets, totals
// ---------------------------------------------------------------------------

const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : 0; };
const round05 = (kg) => Math.round(kg * 2) / 2;
export const fmtKg = (kg) => { const n = round05(kg); return Number.isInteger(n) ? String(n) : n.toFixed(1); };

// Sessions newest first.
export const sortSessions = (sessions) => [...sessions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

export function lastPerformance(exId, sessions) {
  for (const s of sessions) {
    const e = (s.exercises || []).find((x) => x.ex === exId && x.sets && x.sets.length);
    if (e) return { date: s.date, sets: e.sets };
  }
  return null;
}

// One number for "how good was this set": estimated one-rep max for loaded
// sets (Epley), reps for bodyweight, seconds for holds.
const setScore = (s, kind) => {
  if (kind === "time") return num(s.sec);
  const kg = num(s.kg), reps = num(s.reps);
  if (kind === "weight" && kg) return kg * (1 + reps / 30);
  return reps / 1000; // an unloaded set ranks below any loaded one
};

export function bestSetOf(sets, kind) {
  let best = null, score = 0;
  for (const s of sets || []) {
    const sc = setScore(s, kind);
    if (sc > score) { score = sc; best = s; }
  }
  return best ? { ...best, score } : null;
}

export function setLabel(s, kind) {
  if (!s) return "—";
  if (kind === "time") return `${num(s.sec)} s`;
  const kg = num(s.kg);
  return kind === "weight" && kg ? `${fmtKg(kg)} kg × ${num(s.reps)}` : `${num(s.reps)} reps`;
}

// "40 kg × 12, 12, 11" — the way a lifter writes a set of sets down.
export function setsText(e) {
  const sets = e.sets || [];
  if (!sets.length) return "—";
  if (e.kind === "time") return sets.map((s) => `${num(s.sec)} s`).join(", ");
  const kgs = [...new Set(sets.map((s) => num(s.kg)))];
  if (e.kind === "weight" && kgs.length === 1 && kgs[0]) return `${fmtKg(kgs[0])} kg × ${sets.map((s) => num(s.reps)).join(", ")}`;
  if (e.kind === "weight" && kgs.some(Boolean)) return sets.map((s) => (num(s.kg) ? `${fmtKg(num(s.kg))}×${num(s.reps)}` : `${num(s.reps)}`)).join(", ");
  return `${sets.map((s) => num(s.reps)).join(", ")} reps`;
}

export const sessionVolume = (s) => (s.exercises || []).reduce((v, e) =>
  v + (e.kind === "weight" ? (e.sets || []).reduce((a, x) => a + num(x.kg) * num(x.reps), 0) : 0), 0);
export const sessionSets = (s) => (s.exercises || []).reduce((n, e) => n + (e.sets || []).length, 0);

// Best set ever per exercise: Map ex → { set, kind, name, date }.
export function personalBests(sessions) {
  const out = new Map();
  for (const s of sessions) {
    for (const e of s.exercises || []) {
      const b = bestSetOf(e.sets, e.kind);
      if (!b) continue;
      const cur = out.get(e.ex);
      if (!cur || b.score > cur.set.score) out.set(e.ex, { set: b, kind: e.kind, name: e.name, date: s.date });
    }
  }
  return out;
}

// What this workout beat. A first attempt isn't a record — only improving on
// something already logged counts, or every exercise of a first workout would
// light up and the word would mean nothing.
export function newBests(session, prior) {
  const before = personalBests(prior);
  const out = [];
  for (const e of session.exercises || []) {
    const b = bestSetOf(e.sets, e.kind);
    const was = before.get(e.ex);
    if (b && was && b.score > was.set.score + 1e-9) out.push({ ex: e.ex, name: e.name, label: setLabel(b, e.kind), was: setLabel(was.set, e.kind) });
  }
  return out;
}

// newBests for every session at once, walking the log oldest first — the Log
// shows a "new best" line on each card, and per-card comparisons against every
// earlier workout grew with the square of the log.
export function newBestsBySession(sessions) {
  const best = new Map(), out = new Map();
  for (const s of [...sessions].reverse()) {
    const found = [];
    for (const e of s.exercises || []) {
      const b = bestSetOf(e.sets, e.kind);
      if (!b) continue;
      const was = best.get(e.ex);
      if (was && b.score > was.score + 1e-9) found.push({ ex: e.ex, name: e.name, label: setLabel(b, e.kind), was: setLabel(was, e.kind) });
      if (!was || b.score > was.score) best.set(e.ex, b);
    }
    out.set(s.id, found);
  }
  return out;
}

const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const sessionsThisWeek = (sessions, now = new Date()) => {
  const from = mondayOf(now).getTime();
  return sessions.filter((s) => s.date && new Date(s.date).getTime() >= from).length;
};
export const sameDay = (iso, now = new Date()) => !!iso && new Date(iso).toDateString() === now.toDateString();

// ---------------------------------------------------------------------------
// Where you are in a plan, and what to lift today
// ---------------------------------------------------------------------------

// A plan the coach rewrote from another keeps that plan's workouts (`basedOn`),
// so "make it 30 minutes" doesn't send you back to workout 1 of 18.
export function planSessions(plan, sessions) {
  if (!plan) return [];
  const from = plan.startedAt || "";
  return sessions.filter((s) => (s.programId === plan.id || (plan.basedOn && s.programId === plan.basedOn)) && (s.date || "") >= from);
}

// The workout after the last one done in this plan — a rotation, so going to
// the gym on any day of the week still has an answer.
export function nextWorkout(program, done) {
  if (!program || !program.workouts.length) return null;
  const last = done[0];
  const i = last ? program.workouts.findIndex((w) => w.id === last.workoutId) : -1;
  return program.workouts[(i + 1) % program.workouts.length];
}

// Double progression: stay at a weight until every set reaches the top of the
// rep range, then go a step heavier. It is the simplest rule that works, and
// one a beginner can follow without a spreadsheet.
export function suggestion(exId, target, sessions) {
  const ex = EXERCISES[exId];
  if (!ex) return { text: "" };
  const last = lastPerformance(exId, sessions);
  const [lo, hi] = repRange(target);

  if (ex.kind === "time") {
    const goal = target.sec || 30;
    if (!last) return { sec: goal, tone: "new", text: `Hold for ${goal} s${ex.perSide ? " each side" : ""}. Stop early if your form slips.` };
    const best = Math.max(...last.sets.map((s) => num(s.sec)));
    if (best >= goal) {
      const next = Math.min(best + 5, goal + 30);
      return { sec: next, tone: "up", text: `Last time ${best} s — try ${next} s today.` };
    }
    return { sec: goal, tone: "same", text: `Last time ${best} s — aim for ${goal} s.` };
  }

  if (ex.kind === "reps") {
    if (!last) return { reps: hi, tone: "new", text: `Do as many good reps as you can, up to ${hi}.` };
    const reps = last.sets.map((s) => num(s.reps));
    const top = Math.max(...reps), low = Math.min(...reps);
    if (low >= hi) return { reps: hi, tone: "up", text: `You hit ${hi} on every set — slow each rep down to make it harder.` };
    if (top < lo) return { reps: lo, tone: "same", text: `Best set last time was ${top}. Aim for ${lo} today.` };
    return { reps: Math.min(hi, top + 1), tone: "same", text: `Last time ${reps.join(", ")} — go for ${Math.min(hi, top + 1)}.` };
  }

  // weight
  if (!last) {
    return {
      kg: null, reps: hi, tone: "new",
      text: ex.optionalLoad
        ? `No weight is fine to start. Add dumbbells once ${hi} reps feel easy.`
        : `First time: pick a weight you could lift about ${hi + 3} times. It should feel easy — you'll go heavier next time.`,
    };
  }
  const kg = Math.max(0, ...last.sets.map((s) => num(s.kg)));
  const atKg = last.sets.filter((s) => num(s.kg) === kg);
  const reps = atKg.map((s) => num(s.reps));
  const allTop = atKg.length >= target.sets && reps.every((r) => r >= hi);
  const anyLow = reps.some((r) => r < lo);
  const step = ex.inc || INC[ex.equip] || 2.5;
  const inc = Math.max(step, Math.round((kg * 0.05) / step) * step);
  if (!kg) {
    return allTop
      ? { kg: null, reps: lo, tone: "up", text: `${hi} reps on every set — time to hold some light dumbbells.` }
      : { kg: null, reps: Math.min(hi, Math.max(...reps) + 1), tone: "same", text: `Last time ${reps.join(", ")} reps — add one more today.` };
  }
  if (allTop) {
    const next = round05(kg + inc);
    return { kg: next, reps: lo, tone: "up", text: `You hit ${hi} on every set at ${fmtKg(kg)} kg — try ${fmtKg(next)} kg today.` };
  }
  if (anyLow) return { kg, reps: lo, tone: "same", text: `Stay at ${fmtKg(kg)} kg and aim for ${lo}+ reps on every set.` };
  return { kg, reps: Math.min(hi, Math.min(...reps) + 1), tone: "same", text: `Same ${fmtKg(kg)} kg — try for one more rep on each set.` };
}

// ---------------------------------------------------------------------------
// A workout in progress ("draft") and the session it becomes
// ---------------------------------------------------------------------------

export const newSessionId = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const blankSet = () => ({ kg: "", reps: "", sec: "", done: false });

export function draftItem(exId, target, sessions) {
  return {
    ex: exId,
    target: { sets: target.sets, reps: target.reps, sec: target.sec, rest: target.rest || 90 },
    hint: suggestion(exId, target, sessions),
    sets: Array.from({ length: Math.max(1, target.sets || 3) }, blankSet),
  };
}

export function buildDraft(program, workout, sessions) {
  return {
    v: 1,
    id: newSessionId(),
    programId: program ? program.id : null,
    programName: program ? program.name : null,
    workoutId: workout.id,
    workoutName: workout.name,
    startedAt: Date.now(),
    cur: 0,
    rest: null,
    finished: false,
    feel: null,
    note: "",
    items: workout.exercises.filter((t) => EXERCISES[t.ex]).map((t) => draftItem(t.ex, t, sessions)),
  };
}

export const addSet = (item) => ({ ...item, sets: [...item.sets, blankSet()] });

// Only completed sets are kept: a workout cut short is still a workout.
export function draftToSession(d) {
  const exercises = d.items.map((it) => {
    const ex = EXERCISES[it.ex];
    const kind = ex ? ex.kind : "weight";
    const sets = it.sets.filter((s) => s.done).map((s) => (kind === "time"
      ? { sec: num(s.sec) }
      : kind === "weight" ? { kg: num(s.kg), reps: num(s.reps) } : { reps: num(s.reps) }));
    return sets.length ? { ex: it.ex, name: ex ? ex.name : it.ex, kind, sets } : null;
  }).filter(Boolean);
  const times = d.items.flatMap((it) => it.sets.filter((s) => s.done && s.at).map((s) => s.at));
  const end = times.length ? Math.max(...times) : Date.now();
  return {
    id: d.id,
    programId: d.programId,
    programName: d.programName,
    workoutId: d.workoutId,
    workoutName: d.workoutName,
    startedAt: new Date(d.startedAt).toISOString(),
    date: new Date(end).toISOString(),
    durMs: Math.max(60000, Math.min(4 * 3600000, end - d.startedAt)),
    exercises,
    feel: d.feel || null,
    note: (d.note || "").trim() || null,
  };
}

// ---------------------------------------------------------------------------
// AI-made plans. The model's JSON is never trusted: every exercise must resolve
// to one in the library (so it comes with instructions), every number is
// clamped, and anything unusable is dropped rather than guessed at.
// ---------------------------------------------------------------------------

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const NAME_INDEX = (() => {
  const m = new Map();
  for (const x of LIST) {
    m.set(norm(x.id), x.id);
    m.set(norm(x.name), x.id);
    for (const a of x.aka || []) if (!m.has(norm(a))) m.set(norm(a), x.id);
  }
  return m;
})();

export function resolveExercise(v) {
  if (typeof v !== "string" || !v.trim()) return null;
  if (EXERCISES[v]) return v;
  const k = norm(v);
  if (NAME_INDEX.has(k)) return NAME_INDEX.get(k);
  // "Seated dumbbell shoulder press (light)" → the longest library name inside it
  let best = null, len = 0;
  for (const [key, id] of NAME_INDEX) {
    if (key.length >= 5 && k.includes(key) && key.length > len) { best = id; len = key.length; }
  }
  return best;
}

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return isFinite(n) && n >= lo ? Math.min(hi, n) : dflt;
};
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");

export function parseReps(v) {
  if (typeof v === "number" && isFinite(v)) return Math.min(50, Math.max(1, Math.round(v)));
  if (Array.isArray(v) && v.length >= 2) {
    const lo = clampInt(v[0], 1, 50, 0), hi = clampInt(v[1], 1, 50, 0);
    return lo && hi ? (lo === hi ? lo : [Math.min(lo, hi), Math.max(lo, hi)]) : null;
  }
  if (typeof v !== "string") return null;
  const m = v.match(/(\d+)\s*(?:-|–|—|to)\s*(\d+)/);
  if (m) {
    const lo = clampInt(m[1], 1, 50, 0), hi = clampInt(m[2], 1, 50, 0);
    return lo && hi ? (lo === hi ? lo : [Math.min(lo, hi), Math.max(lo, hi)]) : null;
  }
  const one = v.match(/\d+/);
  return one ? clampInt(one[0], 1, 50, null) : null;
}

function normalizeTarget(id, e) {
  const ex = EXERCISES[id];
  const sets = clampInt(e && e.sets, 1, 6, 3);
  const rest = clampInt(e && (e.rest ?? e.restSec ?? e.restSeconds ?? e.rest_seconds), 20, 300, ex.kind === "time" ? 45 : 90);
  if (ex.kind === "time") {
    const sec = clampInt(e && (e.seconds ?? e.sec ?? e.time ?? parseReps(e.reps)), 10, 180, 30);
    return { ex: id, sets, sec, rest };
  }
  const reps = parseReps(e && e.reps) ?? [8, 12];
  return { ex: id, sets, reps, rest };
}

export function normalizeGymPlan(raw) {
  const obj = raw && typeof raw.plan === "object" && raw.plan && !Array.isArray(raw.plan) ? raw.plan : raw;
  if (!obj || typeof obj !== "object") return null;
  const wRaw = Array.isArray(obj.workouts) ? obj.workouts : Array.isArray(obj.days) ? obj.days : [];
  const workouts = [];
  for (const w of wRaw.slice(0, 8)) {
    const seen = new Set(), exercises = [];
    for (const e of (Array.isArray(w && w.exercises) ? w.exercises : []).slice(0, 14)) {
      const id = resolveExercise(e && (e.id ?? e.ex ?? e.exercise ?? e.name));
      if (!id || seen.has(id)) continue;
      seen.add(id);
      exercises.push(normalizeTarget(id, e));
      if (exercises.length >= 9) break;
    }
    if (exercises.length < 2) continue;
    const letter = String.fromCharCode(65 + workouts.length);
    workouts.push({
      id: letter,
      name: str(w.name, 28) || `Workout ${letter}`,
      focus: str(w.focus, 48) || [...new Set(exercises.map((t) => groupOf(EXERCISES[t.ex]).name))].slice(0, 3).join(" · "),
      exercises,
    });
    if (workouts.length >= 6) break;
  }
  if (!workouts.length) return null;
  const level = ["Beginner", "Intermediate", "Advanced"].find((l) => norm(l) === norm(obj.level)) || "Custom";
  const equips = new Set(workouts.flatMap((w) => w.exercises.map((t) => EXERCISES[t.ex].equip)));
  const equip = [...equips].every((e) => e === "bodyweight") ? "No equipment"
    : [...equips].every((e) => e === "bodyweight" || e === "dumbbell") ? "Dumbbells"
      : "Full gym";
  const tips = (Array.isArray(obj.tips) ? obj.tips : Array.isArray(obj.about) ? obj.about : [])
    .map((t) => str(t, 220)).filter(Boolean).slice(0, 4);
  return {
    id: "custom",
    custom: true,
    name: str(obj.name, 36) || "My plan",
    tagline: str(obj.summary ?? obj.tagline, 120) || "Built for you by your coach.",
    level,
    days: clampInt(obj.daysPerWeek ?? obj.days_per_week ?? (typeof obj.days === "number" ? obj.days : null), 1, 6, Math.min(4, Math.max(2, workouts.length))),
    // what the workouts actually take, not what the model said they would
    minutes: Math.round(workouts.reduce((m, w) => m + workoutMinutes(w), 0) / workouts.length / 5) * 5,
    weeks: clampInt(obj.weeks, 2, 16, 6),
    equip,
    color: "purple",
    icon: "sparkles",
    schedule: null,
    about: tips,
    workouts,
  };
}

// The library as the model sees it: one compact line per exercise, so it can
// only ever pick something the app knows how to explain.
export const libraryForPrompt = () => LIST.map((x) =>
  `${x.id}: ${x.name} — ${x.equip}${x.optionalLoad ? " (weights optional)" : ""}; ${[...x.primary, ...x.secondary].map((m) => MUSCLES[m].toLowerCase()).join(", ")}${x.kind === "time" ? "; timed hold" : ""}${x.perSide ? "; per side" : ""}`,
).join("\n");

// Plans the model may edit, in the same JSON it is asked to return.
export const programForPrompt = (p) => ({
  name: p.name, summary: p.tagline, level: p.level, daysPerWeek: p.days, weeks: p.weeks, minutes: p.minutes,
  tips: p.about,
  workouts: p.workouts.map((w) => ({
    name: w.name, focus: w.focus,
    exercises: w.exercises.map((t) => (t.sec
      ? { id: t.ex, sets: t.sets, seconds: t.sec, rest: t.rest }
      : { id: t.ex, sets: t.sets, reps: Array.isArray(t.reps) ? `${t.reps[0]}-${t.reps[1]}` : String(t.reps), rest: t.rest })),
  })),
});

// ---------------------------------------------------------------------------
// What the coach is told about the gym — compact, and only what helps it
// answer: the plan, what's next, what was lifted recently and the best sets.
// ---------------------------------------------------------------------------
export function gymSummary({ program, plan, sessions }) {
  if (!program && !sessions.length) return null;
  const done = planSessions(plan, sessions);
  const next = nextWorkout(program, done);
  const bests = [...personalBests(sessions).entries()]
    .sort((a, b) => (b[1].date || "").localeCompare(a[1].date || ""))
    .slice(0, 10)
    .map(([, b]) => `${b.name} ${setLabel(b.set, b.kind)}`);
  return {
    plan: program ? {
      name: program.name,
      level: program.level,
      daysPerWeek: program.days,
      workoutsDone: done.length,
      totalWorkouts: program.days * program.weeks,
      startedOn: plan && plan.startedAt ? plan.startedAt.slice(0, 10) : null,
    } : null,
    nextWorkout: next ? {
      name: next.name,
      exercises: next.exercises.map((t) => `${EXERCISES[t.ex].name} ${targetLabel(t)}`),
    } : null,
    workoutsThisWeek: sessionsThisWeek(sessions),
    recentWorkouts: sessions.slice(0, 6).map((s) => ({
      date: s.date ? s.date.slice(0, 10) : null,
      workout: s.workoutName,
      minutes: Math.round((s.durMs || 0) / 60000) || null,
      feel: s.feel || null, // 1 (rough) .. 5 (great)
      lifts: (s.exercises || []).map((e) => `${e.name}: ${setsText(e)}`),
    })),
    personalBests: bests,
  };
}
