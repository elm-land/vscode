module Main exposing (main)

import Html exposing (Html)
import UI


main : Html msg
main =
    Html.text (UI.view "123")
