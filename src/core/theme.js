import { createMuiTheme } from '@material-ui/core/styles';

let baseColor, secondbaseColor, portraitBorderColor;

// Create a theme instance.
const theme = createMuiTheme({
  base: {
    backgroundColor: baseColor,
    secondbaseColor: secondbaseColor,
    portraitBorderColor: portraitBorderColor,
  },
});

export default theme;
