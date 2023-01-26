module Main exposing (main)

import Browser
import Documentation exposing (Documentation)
import Html exposing (..)
import Html.Attributes exposing (..)
import Json.Decode


main : Program Flags Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = subscriptions
        , view = view
        }



-- INIT


type alias Flags =
    { author : String
    , package : String
    , version : String
    , moduleName : String
    , typeOrValueName : Maybe String
    , docs : Json.Decode.Value
    }


type alias Model =
    { flags : Flags
    , docs : Maybe Documentation
    }


init : Flags -> ( Model, Cmd Msg )
init flags =
    ( { flags = flags
      , docs = Documentation.fromJson flags.docs
      }
    , Cmd.none
    )



-- UPDATE


type Msg
    = DoNothing


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    ( model, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.none



-- VIEW


css =
    """
body {
    font-family: '
}
"""


view : Model -> Html Msg
view model =
    div [ class "page" ]
        [ node "style" [] [ text css ]
        , h1 [] [ text "Elm package" ]
        , case model.docs of
            Just docs ->
                pre
                    [ style "max-width" "100vw"
                    , style "white-space" "pre-wrap"
                    ]
                    [ code []
                        [ text
                            (docs.modules
                                |> List.map Documentation.toListOfItems
                                |> Debug.toString
                            )
                        ]
                    ]

            Nothing ->
                text "Something went wrong..."
        ]
