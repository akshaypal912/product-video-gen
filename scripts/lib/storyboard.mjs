/**
 * Shared storyboard load + schema validation.
 * Used by validate-storyboard.mjs, apply-storyboard.mjs, and populate-composition.mjs.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(__dirname, "../..");
export const schemaPath = resolve(projectRoot, "schemas/storyboard.schema.json");

export const ALLOWED_SCENE_TYPES = Object.freeze([
  "logo-intro",
  "text-reveal",
  "stat-callout",
  "icon-grid",
  "cta-outro",
]);

const ALLOWED_SCENE_TYPE_SET = new Set(ALLOWED_SCENE_TYPES);

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function structuralRules(data) {
  const errors = [];
  const scenes = Array.isArray(data?.scenes) ? data.scenes : null;
  if (!scenes || scenes.length === 0) {
    return errors;
  }

  scenes.forEach((scene, index) => {
    const type = scene?.type;
    if (typeof type === "string" && !ALLOWED_SCENE_TYPE_SET.has(type)) {
      errors.push({
        instancePath: `/scenes/${index}/type`,
        message: `unknown scene type "${type}"`,
      });
    }
  });

  if (scenes[0]?.type !== "logo-intro") {
    errors.push({
      instancePath: "/scenes/0/type",
      message: 'storyboard must start with scene type "logo-intro"',
    });
  }

  const last = scenes[scenes.length - 1];
  if (last?.type !== "cta-outro") {
    errors.push({
      instancePath: `/scenes/${scenes.length - 1}/type`,
      message: 'storyboard must end with scene type "cta-outro"',
    });
  }

  if (scenes.length >= 2) {
    const middle = scenes.slice(1, -1);
    if (middle.length < 1) {
      errors.push({
        instancePath: "/scenes",
        message:
          "storyboard must include at least one content scene between logo-intro and cta-outro",
      });
    }
  }

  return errors;
}

let compiledValidate;

function getSchemaValidator() {
  if (!compiledValidate) {
    const schema = loadJson(schemaPath);
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      allowUnionTypes: false,
    });
    compiledValidate = ajv.compile(schema);
  }
  return compiledValidate;
}

/**
 * Validate an already-parsed storyboard object.
 * @returns {{ ok: boolean, errors: object[] }}
 */
export function validateStoryboard(data) {
  const validate = getSchemaValidator();
  const schemaOk = validate(data);
  const structural = structuralRules(data);
  const schemaErrors = (schemaOk ? [] : validate.errors || []).filter(
    (err) => err.keyword !== "if",
  );
  const errors = [...schemaErrors, ...structural];
  return { ok: errors.length === 0, errors };
}

export function formatValidationErrors(errors) {
  return errors.map((err) => {
    const path = err.instancePath || "(root)";
    const detail = err.message || "validation failed";
    const params = err.params ? ` ${JSON.stringify(err.params)}` : "";
    return `  - ${path}: ${detail}${params}`;
  });
}

/**
 * Load a storyboard JSON file and validate it.
 * @returns {{ ok: true, data: object } | { ok: false, errors: object[], data?: object }}
 */
export function loadAndValidateStoryboard(storyboardPath) {
  let data;
  try {
    data = loadJson(storyboardPath);
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          instancePath: "",
          message: `Failed to read storyboard: ${err.message}`,
        },
      ],
    };
  }

  const result = validateStoryboard(data);
  return result.ok
    ? { ok: true, data }
    : { ok: false, errors: result.errors, data };
}
