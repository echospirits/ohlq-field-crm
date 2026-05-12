import type { Recipe } from '@prisma/client';

type RecipeFormRecipe = Pick<
  Recipe,
  | 'id'
  | 'name'
  | 'primarySpirit'
  | 'preparation'
  | 'glassware'
  | 'sourceAttribution'
  | 'fitsNeed'
  | 'complexity'
  | 'recipeText'
  | 'instructions'
  | 'garnish'
  | 'season'
  | 'flavorProfile'
  | 'notes'
  | 'photoUrl'
  | 'photoCaption'
>;

type RecipeFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  recipe?: RecipeFormRecipe;
  submitLabel: string;
};

const preparationOptions = ['', 'Shake', 'Stir', 'Build', 'Blend', 'Batch'];
const complexityOptions = [
  '',
  'Easy/Super simple',
  'Intermediate/A few more ingredients',
  'Advanced/Prep or specialty ingredients',
];

export function RecipeForm({ action, recipe, submitLabel }: RecipeFormProps) {
  return (
    <form action={action} className="recipe-form">
      {recipe ? <input name="id" type="hidden" value={recipe.id} /> : null}

      <fieldset>
        <legend>Recipe</legend>
        <div className="form-grid">
          <label>
            Name
            <input name="name" defaultValue={recipe?.name ?? ''} required />
          </label>
          <label>
            Primary spirit
            <input name="primarySpirit" defaultValue={recipe?.primarySpirit ?? ''} />
          </label>
          <label>
            Stir or shake
            <select name="preparation" defaultValue={recipe?.preparation ?? ''}>
              {preparationOptions.map((option) => (
                <option key={option || 'blank'} value={option}>
                  {option || '-- Select --'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Glassware
            <input name="glassware" defaultValue={recipe?.glassware ?? ''} />
          </label>
          <label>
            Fits what need
            <input name="fitsNeed" defaultValue={recipe?.fitsNeed ?? ''} />
          </label>
          <label>
            Complexity
            <select name="complexity" defaultValue={recipe?.complexity ?? ''}>
              {complexityOptions.map((option) => (
                <option key={option || 'blank'} value={option}>
                  {option || '-- Select --'}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Recipe
          <textarea name="recipeText" rows={8} defaultValue={recipe?.recipeText ?? ''} required />
        </label>

        <details className="compact-details nested-details">
          <summary>More recipe detail</summary>
          <div className="form-grid">
            <label>
              Season
              <input name="season" defaultValue={recipe?.season ?? ''} />
            </label>
            <label>
              Flavor profile
              <input name="flavorProfile" defaultValue={recipe?.flavorProfile ?? ''} />
            </label>
            <label>
              Garnish
              <input name="garnish" defaultValue={recipe?.garnish ?? ''} />
            </label>
            <label>
              Originally served at
              <input name="sourceAttribution" defaultValue={recipe?.sourceAttribution ?? ''} />
            </label>
          </div>
          <label>
            Instructions
            <textarea name="instructions" rows={4} defaultValue={recipe?.instructions ?? ''} />
          </label>
          <label>
            Notes
            <textarea name="notes" rows={4} defaultValue={recipe?.notes ?? ''} />
          </label>
        </details>
      </fieldset>

      <fieldset>
        <legend>Photo</legend>
        {recipe?.photoUrl ? (
          <div className="recipe-photo-edit">
            <img alt={recipe.photoCaption || recipe.name} src={recipe.photoUrl} />
            <label className="quick-chip">
              <input name="removePhoto" type="checkbox" />
              <span>Delete photo</span>
            </label>
          </div>
        ) : null}
        <div className="photo-entry fast-photo-entry">
          <h3>Recipe photo</h3>
          <input name="photoFile" type="file" accept="image/*" />
          <input name="photoUrl" type="url" placeholder="Existing photo URL" />
          <input name="photoCaption" placeholder="Caption" defaultValue={recipe?.photoCaption ?? ''} />
        </div>
      </fieldset>

      <button type="submit">{submitLabel}</button>
    </form>
  );
}
