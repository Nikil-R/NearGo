import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { UserLocation, UserPreferences, Trip, TravelMethod } from '../types';

// Initialize Gemini lazily
const getAI = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Gemini API Key is missing!");
    throw new Error("Missing Gemini API Key");
  }
  return new GoogleGenerativeAI(apiKey);
};

const TRIP_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    trips: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.STRING },
          name: { type: SchemaType.STRING, description: "Specific Name of the place" },
          type: { type: SchemaType.STRING, description: "Category" },
          description: { type: SchemaType.STRING, description: "Engaging description" },
          travelTimeMinutes: { type: SchemaType.NUMBER, description: "One-way travel time" },
          stayTimeMinutes: { type: SchemaType.NUMBER, description: "Duration of stay" },
          totalTimeMinutes: { type: SchemaType.NUMBER, description: "Total duration" },
          score: { type: SchemaType.NUMBER, description: "Relevance score" },
          itinerary: { 
            type: SchemaType.ARRAY, 
            items: { type: SchemaType.STRING },
            description: "3-4 bullet points"
          },
          reason: { type: SchemaType.STRING, description: "Why this place?" },
          coordinates: {
            type: SchemaType.OBJECT,
            properties: {
              lat: { type: SchemaType.NUMBER, description: "Latitude" },
              lng: { type: SchemaType.NUMBER, description: "Longitude" }
            },
            required: ["lat", "lng"]
          }
        },
        required: ["id", "name", "type", "description", "travelTimeMinutes", "stayTimeMinutes", "totalTimeMinutes", "score", "itinerary", "reason", "coordinates"]
      }
    }
  },
  required: ["trips"]
};

// --- Math Helpers ---

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

// Calculate straight-line distance in KM
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the earth in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Estimate baseline time based on physics and real-world city constraints
// This is used as a "sanity check" lower bound.
function estimatePhysicsTime(distanceKm: number, method: TravelMethod): number {
  let speedKmH = 25; 
  let routeFactor = 1.3;
  let overheadMins = 5;

  switch (method) {
    case 'Walk':
      speedKmH = 4.5; 
      routeFactor = 1.2; 
      overheadMins = 0;
      break;
      
    case 'Bike': 
      speedKmH = 28; // Conservative city biking speed
      routeFactor = 1.25; 
      overheadMins = 2;
      break;
      
    case 'Public Transport':
      speedKmH = 18; 
      routeFactor = 1.5; 
      overheadMins = 12; 
      break;
      
    case 'Car':
      speedKmH = 22; // City traffic average
      routeFactor = 1.4; 
      overheadMins = 8; 
      break;
  }
  
  const estimatedRoadDistance = distanceKm * routeFactor;
  const travelTimeMinutes = (estimatedRoadDistance / speedKmH) * 60 + overheadMins;
  
  return Math.round(travelTimeMinutes); 
}

// --- Result Cache ---
// We keep a simple in-memory cache to ensure stable results for the same session
const resultCache = new Map<string, Trip[]>();

export const generateTrips = async (
  location: UserLocation,
  prefs: UserPreferences
): Promise<Trip[]> => {
  // Round coordinates to 4 decimal places (~10m) to handle slight GPS jitter
  const cacheKey = `${location.lat.toFixed(4)}|${location.lng.toFixed(4)}|${location.label}|${prefs.timeAvailable}|${prefs.mood}|${prefs.travelMethod}|${prefs.popularity}`;
  
  if (resultCache.has(cacheKey)) {
    console.log("Serving from cache for key:", cacheKey);
    return resultCache.get(cacheKey)!;
  }

  const modelId = "gemini-1.5-flash"; 

  const isManualLocation = location.lat === 0 && location.lng === 0;

  const locationStr = location.label 
    ? (isManualLocation ? location.label : `${location.label} (Lat: ${location.lat}, Lng: ${location.lng})`)
    : `Lat: ${location.lat}, Lng: ${location.lng}`;

  const maxOneWayMinutes = Math.floor((prefs.timeAvailable * 60) * 0.25);
  
  const subredditRef = location.label && location.label !== "Current Location" 
    ? `r/${location.label.replace(/\s+/g, '')}` 
    : "local city subreddits";

   const isFoodiePopular = prefs.mood === 'Foodie' && prefs.popularity === 'popular';

   const coreStrategy = isFoodiePopular 
     ? `
       **STRATEGY: POPULAR & ICONIC FOOD SPOTS.**
       The user explicitly wants popular, well-known, or "famous" places to eat.
       - IGNORE the "Hidden Gems" rule.
       - Suggest places with high review counts (1000+) and 4.5+ ratings.
       - Focus on iconic local dishes, viral food spots, or highly-rated institutions.
       - Variety Ratio: 4x Popular/Iconic, 2x Local Favorites.
     `
     : `
      **CRITICAL PRIORITY: SURFACING "THE BEST UNDERRATED" PLACES.**
      Do not suggest random low-quality obscure places. We want high-quality, high-character spots that are currently flying under the radar.

      DATA MINING SIMULATION (Perform a deep-dive search simulation):
      Act as if you are scraping and analyzing data from ALL of the following specific sources:
      1. **Local Food & Culture Blogs**: Eater Heatmaps (the deep cuts), The Infatuation "Under the Radar", TimeOut "Local Secrets", and verified local food influencer lists.
      2. **Niche Communities**: r/${subredditRef} (specifically "hidden gem" threads), Chowhound archives, specialized forums (Urban Exploration, CoffeeGeek, BeerAdvocate).
      3. **Curated Databases**: Atlas Obscura (Oddities), Roadside America, Michelin Guide (Bib Gourmand only - high quality/value), James Beard semi-finalists (often lesser known).
      4. **Maps Heuristics**: Look for the "Local Legend" pattern: **High Rating (4.7 to 5.0)** but **Low Review Count (<500)**. This signals a place locals love but tourists haven't ruined.

      SELECTION RULES:
      1. **The "Chef/Historian" Test**: Would a local chef eat here on their day off? Would a local historian visit this spot? If yes, include it.
      2. **Avoid "Mid"**: If a place is unknown because it is average, DO NOT suggest it. It must be unknown because it is *hidden*, *new*, or *misunderstood*, but EXCELLENT.
      3. **Variety Ratio**:
         - 4x "Cult Classics" (Incredible quality, loyal local following, zero marketing).
         - 1x "Weird/Unique" (Something that exists nowhere else, e.g. a bar inside a clock tower).
         - 1x "New/Rising" (Opened recently, high buzz among locals, unknown globally).
    `;

  const prompt = `
    User Context:
    - Start Location: ${locationStr}
    - Available Time Window: ${prefs.timeAvailable} hours (${prefs.timeAvailable * 60} minutes)
    - Mood/Preference: ${prefs.mood}
    ${prefs.mood === 'Foodie' ? `- Dining Style: ${prefs.popularity === 'popular' ? "Popular / Famous / Viral" : "Hidden Gems / Hole-in-the-wall"}` : ''}
    - Travel Method: ${prefs.travelMethod}
    - Exploration Goal: Find a mix of high-quality "Hidden Gems" AND iconic "Popular Hotspots" within strict proximity.

    TASK:
    Generate 6 distinct micro-trip recommendations. 
    
    🚨 **SEARCH-READY PROTOCOL - READ CAREFULLY** 🚨:
    
    1. **SEARCHABLE NAMES**: 
       - FORMAT: "[Place Name], [Neighborhood/Specific Area], [City]"
       - Example: "The Hole in the Wall Cafe, Koramangala, Bangalore"
    
    2. **GEOGRAPHIC LOCK**: 
       - Within ${prefs.travelMethod === 'Walk' ? '3km' : prefs.travelMethod === 'Bike' ? '8km' : '15km'} of ${locationStr}.
    
    3. **OUTPUT FORMAT**:
       Return strictly JSON in this format:
       {
         "trips": [
           {
             "id": "unique-id",
             "name": "Full Searchable Name",
             "type": "Place Category",
             "description": "Short engaging description",
             "travelTimeMinutes": number,
             "stayTimeMinutes": number,
             "totalTimeMinutes": number,
             "score": 1-100,
             "itinerary": ["step 1", "step 2", "step 3"],
             "reason": "Why this place?",
             "coordinates": { "lat": number, "lng": number }
           }
         ]
       }

    ${coreStrategy}

    TRAVEL TIME CALCULATION:
    - Estimate travel time realistically based on ${prefs.travelMethod}.
  `;

  try {
    const genAI = getAI();
    const model = genAI.getGenerativeModel({ 
      model: modelId,
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        // @ts-ignore
        responseSchema: TRIP_SCHEMA,
      },
      systemInstruction: isFoodiePopular 
           ? "You are a local foodie guide who knows all the most popular, must-visit, and top-rated restaurants."
           : "You are the ultimate 'Local Insider'. You ignore the Top 10 lists found on TripAdvisor. Instead, you scrape local forums, old blogs, and neighborhood whispers to find the absolute best underrated spots. You care about quality, authenticity, and soul. You despise tourist traps."
    });

    const response = await result.response;
    const jsonText = response.text();
    
    if (!jsonText) throw new Error("No data received from Gemini");

    console.log("Raw Gemini JSON:", jsonText);
    const parsed = JSON.parse(cleanJson(jsonText));
    return processRawTrips(parsed.trips || [], isManualLocation, location, prefs, cacheKey);

  } catch (error) {
    console.warn("Gemini API Error, trying Groq fallback:", error);
    try {
        const groqTrips = await generateWithGroq(prompt, isFoodiePopular);
        return processRawTrips(groqTrips, isManualLocation, location, prefs, cacheKey);
    } catch (groqError) {
        console.error("Groq Fallback Error:", groqError);
        throw error; // Throw original Gemini error if Groq also fails
    }
  }
};

const generateWithGroq = async (prompt: string, isFoodiePopular: boolean): Promise<Trip[]> => {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!apiKey) throw new Error("Groq API Key missing");

    const systemPrompt = isFoodiePopular 
        ? "You are a local foodie guide. Return strictly JSON matching the requested schema."
        : "You are a local insider guide specializing in hidden gems. Return strictly JSON matching the requested schema.";

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt + "\n\nIMPORTANT: Return ONLY a valid JSON object with a 'trips' array. Use the specific schema provided." }
            ],
            response_format: { type: "json_object" },
            temperature: 0
        })
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Groq API Error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response from Groq");

    console.log("Raw Groq JSON:", content);
    const parsed = JSON.parse(cleanJson(content));
    return parsed.trips || [];
};

const cleanJson = (text: string): string => {
    // Remove markdown code blocks if present
    return text.replace(/```json/g, "").replace(/```/g, "").trim();
};

const processRawTrips = (
    rawTrips: Trip[], 
    isManualLocation: boolean, 
    location: UserLocation, 
    prefs: UserPreferences,
    cacheKey: string
): Trip[] => {
    const maxOneWayMinutes = Math.floor((prefs.timeAvailable * 60) * 0.25);

    const verifiedTrips = rawTrips.map(trip => {
      let finalTravelTime = trip.travelTimeMinutes;
      let distKm = 0;

      if (!isManualLocation) {
        distKm = calculateDistance(
          location.lat, 
          location.lng, 
          trip.coordinates.lat, 
          trip.coordinates.lng
        );

        const physicsTime = estimatePhysicsTime(distKm, prefs.travelMethod);

        if (trip.travelTimeMinutes < physicsTime * 0.6) {
           finalTravelTime = physicsTime;
        } else {
           finalTravelTime = Math.max(trip.travelTimeMinutes, physicsTime * 0.8);
        }
      }

      return {
        ...trip,
        travelTimeMinutes: Math.round(finalTravelTime),
        totalTimeMinutes: Math.round((finalTravelTime * 2) + trip.stayTimeMinutes),
        _distKm: distKm 
      };
    }).filter(trip => {
      if (isManualLocation) return true;
      
      // More lenient filtering:
      // Allow a larger buffer (30 mins instead of 15)
      const maxAllowedTravel = maxOneWayMinutes + 30; 
      
      // Distance filter: Allow up to 25km for Car, 12km rest
      const maxDist = prefs.travelMethod === 'Car' ? 25 : 12;
      const isWithinDistance = (trip as any)._distKm <= maxDist; 

      const ok = trip.travelTimeMinutes <= maxAllowedTravel && isWithinDistance;
      if (!ok) console.log("Filtered out trip:", trip.name, "Dist:", (trip as any)._distKm, "Time:", trip.travelTimeMinutes);
      return ok;
    });

    resultCache.set(cacheKey, verifiedTrips);
    return verifiedTrips;
};