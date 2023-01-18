module File exposing (thing)

import Person exposing (Person)


type File
    = File ()
    | NotAFile


thing : File
thing =
    File ()


what : Person -> String
what person =
    person.name
